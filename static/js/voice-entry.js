// Voice Entry — mic + Web Audio waveform, Web Speech dictation, hand off to Write Entry.
(function () {
    const VOICE_TO_WRITE_STORAGE_KEY = 'diariCoreVoiceDraftForWrite';

    function getSpeechRecognitionCtor() {
        return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    function countWords(text) {
        const s = String(text || '').trim();
        if (!s) return 0;
        return s.split(/\s+/).filter(Boolean).length;
    }

    function formatElapsed(ms) {
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function pickRecognitionLang() {
        if (window.DiariVoiceLocale && typeof DiariVoiceLocale.getVoiceLang === 'function') {
            return DiariVoiceLocale.speechRecognitionLang(DiariVoiceLocale.getVoiceLang());
        }
        try {
            const raw = (navigator.language || navigator.userLanguage || 'en-US').trim().replace(/_/g, '-');
            if (!raw) return 'en-US';
            return raw.length > 40 ? raw.slice(0, 40) : raw;
        } catch (_) {
            return 'en-US';
        }
    }

    function pickRecorderMime() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
            return '';
        }
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/aac',
            'audio/ogg;codecs=opus',
        ];
        for (let i = 0; i < candidates.length; i += 1) {
            if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        return '';
    }

    function extensionForMime(mime) {
        const m = String(mime || '').toLowerCase();
        if (m.includes('mp4') || m.includes('aac')) return 'm4a';
        if (m.includes('ogg')) return 'ogg';
        return 'webm';
    }

    function voiceNoticeStorageKey() {
        try {
            const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
            const uid = Number(user?.id || 0);
            if (uid > 0) return `diariVoiceEntryNoticeDismissed:${uid}`;
        } catch (_) {
            /* ignore */
        }
        return 'diariVoiceEntryNoticeDismissed';
    }

    function initVoiceEntryNoticeModal() {
        const modal = document.getElementById('voiceEntryNoticeModal');
        const okBtn = document.getElementById('voiceEntryNoticeOkBtn');
        const dontShowCheckbox = document.getElementById('voiceEntryNoticeDontShow');
        if (!modal || !okBtn) return;

        const noticeKey = voiceNoticeStorageKey();

        function closeNotice() {
            modal.hidden = true;
            document.body.style.overflow = '';
            if (dontShowCheckbox && dontShowCheckbox.checked) {
                try {
                    localStorage.setItem(noticeKey, '1');
                } catch (_) {}
            }
        }

        function openNotice() {
            modal.hidden = false;
            document.body.style.overflow = 'hidden';
            okBtn.focus();
        }

        okBtn.addEventListener('click', closeNotice);
        modal.querySelectorAll('[data-voice-notice-dismiss]').forEach(function (el) {
            el.addEventListener('click', closeNotice);
        });
        modal.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') closeNotice();
        });

        let dismissed = false;
        try {
            dismissed = localStorage.getItem(noticeKey) === '1';
        } catch (_) {}
        if (!dismissed) {
            openNotice();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        try {
            initVoiceEntryNoticeModal();
    let isRecording = false;
            let mediaRecorder = null;
    let audioChunks = [];
            let mediaStream = null;
            let startTime = null;
            let recognition = null;
            let wantRecognitionRunning = false;
            let speechFinalText = '';

            let audioContext = null;
            let mediaSourceNode = null;
            let analyserNode = null;
            let freqData = null;
            let recordingRafId = null;

            const voiceRoot = document.querySelector('.voice-entry-container');
    const voiceCircle = document.getElementById('voiceCircle');
    const micIcon = document.getElementById('micIcon');
    const statusText = document.getElementById('statusText');
    const finalTranscript = document.getElementById('finalTranscript');
    const recordingState = document.getElementById('recordingState');
            const recordingTimeEl = document.getElementById('voiceEntryRecordingTime');
    const postRecordingContainer = document.getElementById('postRecordingContainer');
    const recordingDuration = document.getElementById('recordingDuration');
    const wordCount = document.getElementById('wordCount');
    const retryBtn = document.getElementById('retryBtn');
    const saveBtn = document.getElementById('saveBtn');
    const mobileSaveBtn = document.getElementById('saveEntryBtn');
    const mobileRetryBtn = document.getElementById('mobileRetryBtn');
            const transcriptHint = document.getElementById('voiceTranscriptHint');
            const voiceLangSelect = document.getElementById('voiceLangSelect');
            const waveBarEls = voiceRoot
                ? Array.from(voiceRoot.querySelectorAll('.voice-wave-bar'))
                : Array.from(document.querySelectorAll('.voice-wave-bar'));
    
            const speechSupported = Boolean(getSpeechRecognitionCtor());
    const isMobile = window.innerWidth <= 768;
            /** Retries after `audio-capture` (often race: speech engine vs mic permission). */
            let speechCaptureRetries = 0;

            if (speechSupported && window.isSecureContext === false && statusText) {
                statusText.textContent =
                    'Live voice captions need HTTPS (or localhost). This page is not a secure context, so dictation may not run.';
            }

    if (isMobile && statusText) {
                if (!(speechSupported && window.isSecureContext === false)) {
        statusText.textContent = 'Tap to record';
                }
            }

            if (voiceLangSelect && window.DiariVoiceLocale) {
                const stored = DiariVoiceLocale.getStoredChoice();
                voiceLangSelect.value = stored === 'en' || stored === 'tl' ? stored : 'auto';
                voiceLangSelect.addEventListener('change', function () {
                    DiariVoiceLocale.setVoiceLang(voiceLangSelect.value);
                    if (statusText && !isRecording) {
                        const vl = DiariVoiceLocale.getVoiceLang();
                        const base = isMobile ? 'Tap to record' : 'Tap to start recording';
                        statusText.textContent = base + ' · ' + DiariVoiceLocale.labelFor(vl);
                    }
                });
                if (statusText && !isRecording && !(speechSupported && window.isSecureContext === false)) {
                    const vl = DiariVoiceLocale.getVoiceLang();
                    const base = isMobile ? 'Tap to record' : 'Tap to start recording';
                    statusText.textContent = base + ' · ' + DiariVoiceLocale.labelFor(vl);
                }
            }

    if (isMobile && mobileRetryBtn) {
                setTimeout(function () {
            mobileRetryBtn.style.setProperty('display', 'flex', 'important');
        }, 100);
                window.addEventListener('load', function () {
                    setTimeout(function () {
                mobileRetryBtn.style.setProperty('display', 'flex', 'important');
                mobileRetryBtn.style.color = 'white';
                mobileRetryBtn.style.backgroundColor = 'var(--primary-bg)';
            }, 50);
        });
    }
    
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
            if (sidebarToggle && sidebar) {
                sidebarToggle.addEventListener('click', function () {
            sidebar.classList.toggle('collapsed');
        });
    }
    
            function setPostPanelVisible(visible) {
                if (!postRecordingContainer) return;
                if (window.innerWidth > 991) {
                    postRecordingContainer.hidden = false;
                } else {
                    // On mobile: once shown (after first recording), keep it always visible
                    if (visible) {
                        postRecordingContainer.hidden = false;
                    }
                    // Never hide again on mobile — Clear/Retry keeps it visible
                }
            }
            setPostPanelVisible(true);

            function setTranscriptHint(message) {
                if (!transcriptHint) return;
                const s = String(message || '').trim();
                if (s) {
                    transcriptHint.textContent = s;
                    transcriptHint.hidden = false;
                } else {
                    transcriptHint.textContent = '';
                    transcriptHint.hidden = true;
                }
            }

            function updateTranscriptReadonly() {
                if (!finalTranscript) return;
                /* Always allow typing so users can fall back if live captions fail (e.g. Brave Shields). */
                finalTranscript.readOnly = false;
            }

            function updateWordCountFromTranscript() {
                if (!wordCount || !finalTranscript) return;
                wordCount.textContent = String(countWords(finalTranscript.value));
            }

            function stopMediaStream() {
                if (mediaStream) {
                    mediaStream.getTracks().forEach(function (t) {
                        t.stop();
                    });
                    mediaStream = null;
                }
            }

            function teardownAudioGraph() {
                if (recordingRafId != null) {
                    cancelAnimationFrame(recordingRafId);
                    recordingRafId = null;
                }
                try {
                    if (mediaSourceNode) {
                        mediaSourceNode.disconnect();
                        mediaSourceNode = null;
                    }
                } catch (_) {}
                try {
                    if (analyserNode) {
                        analyserNode.disconnect();
                        analyserNode = null;
                    }
                } catch (_) {}
                freqData = null;
                /* Keep AudioContext alive across sessions so iOS/Safari stay unlocked after first user gesture. */
            }

            function stopSpeechRecognition() {
                wantRecognitionRunning = false;
                if (!recognition) return;
                const rec = recognition;
                recognition = null;
                try {
                    if (typeof rec.stop === 'function') rec.stop();
                    else if (typeof rec.abort === 'function') rec.abort();
                } catch (_) {}
            }

            /** Stop dictation and wait for final `onresult` chunks (do not clear handlers before stop). */
            function stopSpeechRecognitionAsync() {
                return new Promise(function (resolve) {
                    wantRecognitionRunning = false;
                    const rec = recognition;
                    if (!rec) {
                        resolve();
                        return;
                    }
                    let settled = false;
                    const finish = function () {
                        if (settled) return;
                        settled = true;
                        recognition = null;
                        resolve();
                    };
                    const prevOnEnd = rec.onend;
                    rec.onend = function () {
                        if (typeof prevOnEnd === 'function') {
                            try {
                                prevOnEnd();
                            } catch (_) {}
                        }
                        finish();
                    };
                    try {
                        rec.stop();
                    } catch (_) {
                        finish();
                    }
                    setTimeout(finish, 900);
                });
            }

            function primeAudioFromUserGesture() {
                try {
                    const Ctor = window.AudioContext || window.webkitAudioContext;
                    if (!Ctor) return;
                    if (!audioContext) audioContext = new Ctor();
                    if (audioContext.state === 'suspended') {
                        void audioContext.resume();
                    }
                } catch (_) {}
            }

            function attachSpeechRecognition() {
                const Ctor = getSpeechRecognitionCtor();
                if (!Ctor) return;
                speechFinalText = '';
                recognition = new Ctor();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = pickRecognitionLang();
                if ('maxAlternatives' in recognition) {
                    recognition.maxAlternatives = 1;
                }

                recognition.onstart = function () {
                    setTranscriptHint('Listening… speak clearly. Text will appear below as you talk.');
                };

                recognition.onresult = function (event) {
                    let interim = '';
                    for (let i = event.resultIndex; i < event.results.length; i += 1) {
                        const res = event.results[i];
                        if (!res || !res[0]) continue;
                        const piece = res[0].transcript || '';
                        if (res.isFinal) {
                            speechFinalText += (speechFinalText && piece ? ' ' : '') + piece;
                        } else {
                            interim += piece;
                        }
                    }
                    if (finalTranscript) {
                        const combined = speechFinalText + interim;
                        finalTranscript.value = combined.replace(/\s+/g, ' ').trim();
                        updateWordCountFromTranscript();
                    }
                };

                recognition.onerror = function (ev) {
                    const err = ev && ev.error ? ev.error : '';
                    if (err === 'no-speech' || err === 'aborted') return;
                    if (err === 'audio-capture') {
                        if (mediaStream && wantRecognitionRunning && speechCaptureRetries < 2) {
                            speechCaptureRetries += 1;
                            setTranscriptHint(
                                'Speech engine could not read the microphone yet — retrying live captions…'
                            );
                            setTimeout(function () {
                                if (!mediaStream || !wantRecognitionRunning) return;
                                try {
                                    recognition.onend = null;
                                    recognition.stop();
                                } catch (_) {}
                                recognition = null;
                                attachSpeechRecognition();
                                wantRecognitionRunning = true;
                                try {
                                    recognition.start();
                                    setTranscriptHint(
                                        'Listening… speak clearly. Text will appear below as you talk.'
                                    );
                                } catch (_) {
                                    stopSpeechRecognition();
                                    setTranscriptHint(
                                        'Live captions could not use the microphone. You can type your entry below.'
                                    );
                                }
                            }, 350);
                        } else if (mediaStream) {
                            wantRecognitionRunning = false;
                            setTranscriptHint(
                                'Live captions could not access the microphone. Try closing other apps using the mic, or type below.'
                            );
                        }
                        return;
                    }
                    if (err === 'not-allowed') {
                        wantRecognitionRunning = false;
                        setTranscriptHint(
                            'Speech recognition was blocked. Check site permissions for the microphone.'
                        );
                        if (statusText) {
                            statusText.style.display = 'block';
                            statusText.textContent = 'Microphone or speech access blocked.';
                        }
                        return;
                    }
                    if (err === 'network' || err === 'service-not-allowed') {
                        wantRecognitionRunning = false;
                        setTranscriptHint(
                            'Browser live captions are blocked (often Brave Shields). Keep talking, then tap stop — we will transcribe the recording on your device if the box is still empty. You can also type below.'
                        );
                        return;
                    }
                    wantRecognitionRunning = false;
                    setTranscriptHint(
                        'Speech recognition stopped (' + err + '). You can type your entry in the box above.'
                    );
                };

                recognition.onend = function () {
                    if (!wantRecognitionRunning || !isRecording) return;
                    setTimeout(function () {
                        if (!wantRecognitionRunning || !isRecording || !recognition) return;
                        try {
                            recognition.start();
                        } catch (_) {}
                    }, 220);
                };
            }

            function updateTimerDisplay() {
                if (!recordingTimeEl || !startTime) return;
                recordingTimeEl.textContent = formatElapsed(Date.now() - startTime);
            }

            function updateWaveBars(nowMs) {
                if (!waveBarEls.length) return;
                const t = nowMs * 0.001;
                if (analyserNode && freqData) {
                    analyserNode.getByteFrequencyData(freqData);
                    const n = freqData.length;
                    let energy = 0;
                    const band = Math.min(24, n);
                    for (let i = 0; i < band; i += 1) energy += freqData[i];
                    energy = energy / (band * 255);

                    waveBarEls.forEach(function (bar, i) {
                        const binIdx = Math.min(n - 1, 3 + i * Math.max(1, Math.floor(n / (waveBarEls.length * 4))));
                        const bin = freqData[binIdx] / 255;
                        const idle = 0.1 + 0.09 * Math.sin(t * 2.4 + i * 0.5);
                        const spike = energy * 1.25 + bin * 0.95;
                        const scaleY = Math.min(1, Math.max(0.07, idle + spike));
                        bar.style.transform = 'scaleY(' + scaleY + ')';
                    });
                } else {
                    waveBarEls.forEach(function (bar, i) {
                        const idle = 0.12 + 0.1 * Math.sin(t * 2.4 + i * 0.5);
                        bar.style.transform = 'scaleY(' + idle + ')';
                    });
                }
            }

            function tickRecordingUi() {
                if (!isRecording) {
                    recordingRafId = null;
                    return;
                }
                const now = performance.now();
                updateTimerDisplay();
                updateWaveBars(now);
                recordingRafId = requestAnimationFrame(tickRecordingUi);
            }

            function startRecordingUiLoop() {
                if (recordingRafId != null) {
                    cancelAnimationFrame(recordingRafId);
                    recordingRafId = null;
                }
                updateTimerDisplay();
                recordingRafId = requestAnimationFrame(tickRecordingUi);
            }

            function startBackupMediaRecorder() {
                mediaRecorder = null;
                if (typeof MediaRecorder === 'undefined' || !mediaStream) return;
                const mime = pickRecorderMime();
                try {
                    mediaRecorder = mime
                        ? new MediaRecorder(mediaStream, { mimeType: mime })
                        : new MediaRecorder(mediaStream);
                } catch (_) {
                    try {
                        mediaRecorder = new MediaRecorder(mediaStream);
                    } catch (e2) {
                        mediaRecorder = null;
                        console.warn('MediaRecorder unavailable:', e2);
                    }
                }
                if (!mediaRecorder) return;
                audioChunks = [];
                mediaRecorder.ondataavailable = function (event) {
                    if (event.data && event.data.size) audioChunks.push(event.data);
                };
                mediaRecorder.onstop = function () {};
                try {
                    mediaRecorder.start(500);
                } catch (e3) {
                    console.warn('MediaRecorder.start failed:', e3);
                    mediaRecorder = null;
                }
            }

            function flushSpeechToTranscript() {
                if (!finalTranscript) return;
                const fromSpeech = String(speechFinalText || '').replace(/\s+/g, ' ').trim();
                const current = String(finalTranscript.value || '').replace(/\s+/g, ' ').trim();
                const combined = current.length >= fromSpeech.length ? current : fromSpeech;
                if (combined) {
                    finalTranscript.value = combined;
                    updateWordCountFromTranscript();
                }
            }

            let lastAudioBlob = null;
            const aiTranscribeBtn = document.getElementById('aiTranscribeBtn');

            async function transcribeOnDevice(blob) {
                if (!window.DiariVoiceClient || typeof DiariVoiceClient.transcribeBlob !== 'function') {
                    return '';
                }
                if (DiariVoiceClient.isSupported && !DiariVoiceClient.isSupported()) {
                    return '';
                }
                const voiceLang =
                    window.DiariVoiceLocale && typeof DiariVoiceLocale.getVoiceLang === 'function'
                        ? DiariVoiceLocale.getVoiceLang()
                        : 'en';
                return DiariVoiceClient.transcribeBlob(blob, {
                    onStatus: setTranscriptHint,
                    voiceLang: voiceLang,
                });
            }

            function clientTranscribeFailureHint(err) {
                if (speechSupported) {
                    return 'Live captions did not capture speech. Tap "AI Transcribe" below or type your entry.';
                }
                return 'Automatic transcription is unavailable in this browser. Type your entry below.';
            }

            function isSilenceArtifactText(rawText) {
                const normText = String(rawText || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                return (
                    normText === '' ||
                    normText === 'so' ||
                    normText === 'you' ||
                    normText === 'thankyou' ||
                    normText === 'thanksforwatching' ||
                    normText === 'subtitlesby' ||
                    normText === 'theend' ||
                    normText === 'bye' ||
                    normText === 'music' ||
                    normText === 'silence'
                );
            }

            function isCreditsError(errText, status) {
                const s = String(errText || '').toLowerCase();
                return (
                    status === 402 ||
                    status === 429 ||
                    s.indexOf('credits_exhausted') !== -1 ||
                    s.indexOf('credit') !== -1 ||
                    s.indexOf('quota') !== -1 ||
                    s.indexOf('temporarily unavailable') !== -1 ||
                    s.indexOf('rate-limited') !== -1 ||
                    s.indexOf('rate limited') !== -1
                );
            }

            async function transcribeRecordingBlobIfNeeded(blob, forceAi) {
                if (!blob || blob.size < 200) return;
                lastAudioBlob = blob;
                if (!finalTranscript) return;

                const existingText = finalTranscript.value.trim();
                if (!forceAi && existingText.length >= 10) return;
                // Preserve live-caption text: server/on-device results replace it
                // only when they produce real speech, never wipe it on failure.
                const fallbackText = existingText;

                setTranscriptHint('Transcribing audio… trying server AI first, then free on-device backup if needed.');
                if (aiTranscribeBtn) {
                    aiTranscribeBtn.disabled = true;
                    aiTranscribeBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Transcribing…';
                }

                async function tryServerTranscribe() {
                    const formData = new FormData();
                    const ext = extensionForMime(blob.type || 'audio/webm');
                    formData.append('audio', blob, `recording.${ext}`);
                    const voiceLang =
                        window.DiariVoiceLocale && typeof DiariVoiceLocale.getVoiceLang === 'function'
                            ? DiariVoiceLocale.getVoiceLang()
                            : 'en';
                    formData.append('language', voiceLang);

                    const headers = {};
                    try {
                        const user = JSON.parse(localStorage.getItem('diariCoreUser') || '{}');
                        if (user && user.csrfToken) {
                            headers['X-CSRFToken'] = user.csrfToken;
                        }
                    } catch (_) {}

                    const res = await fetch('/api/voice/transcribe', {
                        method: 'POST',
                        headers: headers,
                        body: formData,
                    });
                    let data = null;
                    try {
                        data = await res.json();
                    } catch (_) {
                        data = null;
                    }
                    const rawText = data && data.text ? String(data.text).trim() : '';
                    const errText = data && data.error ? String(data.error) : '';
                    const source = data && data.source ? String(data.source) : '';
                    return { ok: res.ok, status: res.status, success: Boolean(data && data.success), text: rawText, error: errText, source: source };
                }

                async function tryOnDeviceTranscribe(reason) {
                    let deviceText = '';
                    try {
                        if (reason) setTranscriptHint(reason);
                        deviceText = String((await transcribeOnDevice(blob)) || '').trim();
                    } catch (deviceErr) {
                        console.warn('On-device transcription failed:', deviceErr);
                        deviceText = '';
                    }
                    if (deviceText && !isSilenceArtifactText(deviceText)) {
                        finalTranscript.value = deviceText;
                        updateWordCountFromTranscript();
                        setTranscriptHint(
                            'Transcribed on your device (free, no server credits used). Edit any mistakes above before saving.'
                        );
                        return true;
                    }
                    return false;
                }

                try {
                    let server = null;
                    try {
                        server = await tryServerTranscribe();
                    } catch (e) {
                        console.warn('Server transcription request failed, trying on-device:', e);
                        server = { ok: false, status: 0, success: false, text: '', error: String((e && e.message) || e || 'network error') };
                    }

                    if (server && server.ok && server.success && server.text && !isSilenceArtifactText(server.text)) {
                        finalTranscript.value = server.text;
                        updateWordCountFromTranscript();
                        setTranscriptHint(
                            server.source === 'groq_whisper'
                                ? 'Transcribed with Groq Whisper (fast)! Edit any mistakes above before saving.'
                                : 'Transcribed with server AI! Edit any mistakes above before saving.'
                        );
                        return;
                    }

                    // Server gave no usable speech: decide between true silence vs service failure.
                    const serverFailed = !server || !server.ok || !server.success;
                    const serverErr = server ? server.error : '';
                    const serverStatus = server ? server.status : 0;

                    if (serverFailed && isCreditsError(serverErr, serverStatus)) {
                        console.warn('Server transcription unavailable, falling back to free on-device:', serverErr || serverStatus);
                        const deviceOk = await tryOnDeviceTranscribe(
                            'Server AI is out of credits/unavailable — transcribing on your device for free instead…'
                        );
                        if (deviceOk) return;
                        // Both failed: keep any live-caption text, don't wipe it.
                        if (fallbackText) {
                            finalTranscript.value = fallbackText;
                            updateWordCountFromTranscript();
                        }
                        setTranscriptHint(
                            'Server AI is unavailable (credits/rate limit) and on-device transcription found no clear speech. ' +
                            'If you spoke, try Chrome/Edge with mic allowed, speak 2–3+ seconds, or type below. No new token is required for on-device mode.'
                        );
                        return;
                    }

                    if (serverFailed && serverStatus === 401) {
                        if (fallbackText) {
                            finalTranscript.value = fallbackText;
                            updateWordCountFromTranscript();
                        }
                        setTranscriptHint('Please log in again to use server transcription — or type your entry below.');
                        return;
                    }

                    // Any other server failure (or silence): try free on-device before giving up.
                    if (serverFailed || !server.text || isSilenceArtifactText(server.text)) {
                        const deviceOk = await tryOnDeviceTranscribe(
                            serverFailed
                                ? 'Server transcription failed — trying free on-device transcription…'
                                : 'Double-checking with free on-device transcription…'
                        );
                        if (deviceOk) return;
                    }

                    // True no-speech case: restore live-caption text if there was any.
                    if (fallbackText) {
                        finalTranscript.value = fallbackText;
                        updateWordCountFromTranscript();
                        if (fallbackText.length >= 10) return;
                    }
                    const defaultNoSpeechMsg = "It seems like you didn't talk during the recording. No words were transcribed — please try again.";
                    console.warn('Server transcription note:', serverErr || serverStatus);
                    setTranscriptHint(serverErr && serverErr.length < 300 ? serverErr : defaultNoSpeechMsg);
                } catch (e) {
                    console.error('Transcription request failed:', e);
                    if (fallbackText) {
                        finalTranscript.value = fallbackText;
                        updateWordCountFromTranscript();
                        if (fallbackText.length >= 10) return;
                    }
                    // Last resort: on-device even after an unexpected error.
                    try {
                        const deviceOk = await tryOnDeviceTranscribe('Trying free on-device transcription…');
                        if (deviceOk) return;
                    } catch (_) {}
                    setTranscriptHint("Transcription failed. Check mic access, speak 2–3+ seconds, use Chrome/Edge — or type your entry below.");
                } finally {
                    if (aiTranscribeBtn) {
                        aiTranscribeBtn.disabled = false;
                        aiTranscribeBtn.innerHTML = '<i class="bi bi-lightning-charge-fill text-warning"></i> AI Transcribe';
                    }
                }
            }

            if (voiceCircle) {
                voiceCircle.addEventListener('click', function () {
        if (!isRecording) {
                        primeAudioFromUserGesture();
                        void startRecording();
        } else {
                        void stopRecording();
        }
    });
            }
    
    async function startRecording() {
                teardownAudioGraph();
                await stopSpeechRecognitionAsync();
                stopMediaStream();
                await new Promise(function (resolve) {
                    setTimeout(resolve, 220);
                });

                try {
                    speechFinalText = '';
                    setTranscriptHint('');
                    if (finalTranscript) {
                        finalTranscript.value = '';
                        finalTranscript.readOnly = false;
                    }
                    updateWordCountFromTranscript();

                    mediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                        },
                    });

                    /* Show transcript + hint while speech connects; otherwise errors are easy to miss (parent was hidden). */
                    setPostPanelVisible(true);

                    /*
                     * Start Web Speech only after the mic is live. Starting earlier triggers `audio-capture`
                     * on many Chromium builds (we used to ignore it and recognition never produced results).
                     * Call start() before awaiting AudioContext.resume so we stay in the getUserMedia success
                     * continuation where user activation is still available in Chrome.
                     */
                    speechCaptureRetries = 0;
                    if (speechSupported) {
                        attachSpeechRecognition();
                        wantRecognitionRunning = true;
                        try {
                            recognition.start();
                            setTranscriptHint(
                                'Listening… speak clearly. Text will appear below as you talk.'
                            );
                        } catch (postMicErr) {
                            console.error('SpeechRecognition.start failed:', postMicErr);
                            stopSpeechRecognition();
                            setTranscriptHint(
                                'Could not start live captions. Type below, or try Chrome / Edge with microphone allowed.'
                            );
                        }
                    }

                    const AC = window.AudioContext || window.webkitAudioContext;
                    if (AC) {
                        if (!audioContext) audioContext = new AC();
                        await audioContext.resume();
                        mediaSourceNode = audioContext.createMediaStreamSource(mediaStream);
                        analyserNode = audioContext.createAnalyser();
                        analyserNode.fftSize = 256;
                        analyserNode.smoothingTimeConstant = 0.72;
                        mediaSourceNode.connect(analyserNode);
                        freqData = new Uint8Array(analyserNode.frequencyBinCount);
                    }

                    /* Always capture audio so we can transcribe on-device when live captions fail. */
                    startBackupMediaRecorder();

            isRecording = true;
            startTime = Date.now();
                    updateTranscriptReadonly();

                    if (micIcon) micIcon.className = 'bi bi-stop-fill';
                    if (voiceCircle) voiceCircle.classList.add('recording');
                    if (recordingState) recordingState.style.display = 'block';
                    if (statusText) statusText.style.display = 'none';
            if (isMobile && mobileRetryBtn) {
                mobileRetryBtn.style.display = 'none';
            }
            
                    if (!speechSupported && statusText) {
                        statusText.style.display = 'block';
                        statusText.textContent =
                            'Recording… Add text below, or use Chrome / Edge for live captions.';
                    }

                    startRecordingUiLoop();
        } catch (error) {
            console.error('Error accessing microphone:', error);
                    teardownAudioGraph();
                    stopSpeechRecognition();
                    stopMediaStream();
                    isRecording = false;
                    startTime = null;
                    if (statusText) {
                        statusText.style.display = 'block';
                        statusText.textContent = 'Microphone access denied or unavailable.';
                    }
                    if (recordingState) recordingState.style.display = 'none';
                    if (voiceCircle) voiceCircle.classList.remove('recording');
                    if (micIcon) micIcon.className = 'bi bi-mic';
                }
            }

            async function stopRecording() {
                if (recordingRafId != null) {
                    cancelAnimationFrame(recordingRafId);
                    recordingRafId = null;
                }

                const elapsed = startTime ? Date.now() - startTime : 0;
                await stopSpeechRecognitionAsync();
                flushSpeechToTranscript();

                function applyStoppedUi(blob) {
                    teardownAudioGraph();
                    stopMediaStream();
        
        isRecording = false;
                    if (micIcon) micIcon.className = 'bi bi-mic';
                    if (voiceCircle) voiceCircle.classList.remove('recording');
                    if (recordingState) recordingState.style.display = 'none';
                    if (statusText) {
        statusText.style.display = 'block';
        statusText.textContent = 'Recording complete';
                    }
        if (isMobile && mobileRetryBtn) {
            mobileRetryBtn.style.setProperty('display', 'flex', 'important');
        }
        
                    startTime = null;
                    if (recordingDuration) {
                        recordingDuration.textContent = formatElapsed(elapsed);
                    }
                    if (recordingTimeEl) {
                        recordingTimeEl.textContent = formatElapsed(elapsed);
                    }

                    updateTranscriptReadonly();
                    updateWordCountFromTranscript();

                    if (!speechSupported && finalTranscript && !finalTranscript.value.trim()) {
                        finalTranscript.placeholder =
                            'Type what you said here, or try Chrome / Edge on desktop for live dictation.';
                    }

                    setPostPanelVisible(true);

                    if (blob && blob.size > 200) {
                        void transcribeRecordingBlobIfNeeded(blob);
                    } else if (!finalTranscript.value.trim()) {
                        setTranscriptHint(
                            'No audio was captured. Hold the mic a little longer, allow microphone access, or type your entry below.'
                        );
                    }
                }

                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    try {
                        const recorderMime = mediaRecorder.mimeType || pickRecorderMime() || 'audio/webm';
                        mediaRecorder.onstop = function () {
                            const t = recorderMime || 'audio/webm';
                            const blob = new Blob(audioChunks, { type: t });
                            mediaRecorder = null;
                            applyStoppedUi(blob);
                        };
                        try {
                            mediaRecorder.requestData();
                        } catch (_) {}
                        mediaRecorder.stop();
                    } catch (_) {
                        mediaRecorder = null;
                        applyStoppedUi(null);
                    }
                } else {
                    if (mediaRecorder) {
                        mediaRecorder = null;
                    }
                    applyStoppedUi(null);
                }
    }
    
    function resetRecording() {
                if (recordingRafId != null) {
                    cancelAnimationFrame(recordingRafId);
                    recordingRafId = null;
                }
                void stopSpeechRecognitionAsync();
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    try {
                        mediaRecorder.stop();
                    } catch (_) {}
                    mediaRecorder = null;
                }
                teardownAudioGraph();
                stopMediaStream();
                isRecording = false;
                startTime = null;
                speechFinalText = '';

                setPostPanelVisible(false);
                setTranscriptHint('');
                if (finalTranscript) {
                    finalTranscript.value = '';
                    finalTranscript.readOnly = false;
                    finalTranscript.placeholder =
                        'Your speech will appear here as you speak. You can also type or paste if your browser does not support dictation.';
                }
                if (recordingDuration) recordingDuration.textContent = '00:00';
                if (recordingTimeEl) recordingTimeEl.textContent = '0:00';
                if (wordCount) wordCount.textContent = '0';
                if (statusText) {
        statusText.style.display = 'block';
        statusText.textContent = isMobile ? 'Tap to record' : 'Tap to start recording';
                }
                if (micIcon) micIcon.className = 'bi bi-mic';
                if (voiceCircle) voiceCircle.classList.remove('recording');
                if (recordingState) recordingState.style.display = 'none';
        if (isMobile && mobileRetryBtn) {
            mobileRetryBtn.style.setProperty('display', 'flex', 'important');
        }
                waveBarEls.forEach(function (bar) {
                    bar.style.transform = 'scaleY(0.15)';
                });
        audioChunks = [];
    }
    
            if (finalTranscript) {
                finalTranscript.addEventListener('input', updateWordCountFromTranscript);
            }

            // AI Transcribe button removed — transcription is automatic on stop

            if (retryBtn) {
                retryBtn.addEventListener('click', function () {
                    if (isMobile) {
                        // Mobile Clear / Retry: keep transcript panel, scroll to recorder, clear text, then auto-start
                        const recorderEl = document.querySelector('.voice-entry-container');

                        // 1. Clear state (but don't hide the transcript panel)
                        if (recordingRafId != null) {
                            cancelAnimationFrame(recordingRafId);
                            recordingRafId = null;
                        }
                        void stopSpeechRecognitionAsync();
                        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                            try { mediaRecorder.stop(); } catch (_) {}
                            mediaRecorder = null;
                        }
                        teardownAudioGraph();
                        stopMediaStream();
                        isRecording = false;
                        startTime = null;
                        speechFinalText = '';
                        audioChunks = [];

                        // 2. Clear transcript UI
                        setTranscriptHint('');
                        if (finalTranscript) {
                            finalTranscript.value = '';
                            finalTranscript.readOnly = false;
                            finalTranscript.placeholder =
                                'Your speech will appear here as you speak. You can also type or paste directly.';
                        }
                        if (recordingDuration) recordingDuration.textContent = '00:00';
                        if (recordingTimeEl) recordingTimeEl.textContent = '0:00';
                        if (wordCount) wordCount.textContent = '0';

                        // 3. Reset mic circle state
                        if (statusText) {
                            statusText.style.display = 'block';
                            statusText.textContent = 'Tap to record';
                        }
                        if (micIcon) micIcon.className = 'bi bi-mic';
                        if (voiceCircle) voiceCircle.classList.remove('recording');
                        if (recordingState) recordingState.style.display = 'none';
                        waveBarEls.forEach(function (bar) {
                            bar.style.transform = 'scaleY(0.15)';
                        });

                        // 4. Smooth scroll to recorder, then auto-start recording
                        if (recorderEl) {
                            recorderEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            setTimeout(function () {
                                if (voiceCircle) voiceCircle.click();
                            }, 500);
                        } else {
                            if (voiceCircle) voiceCircle.click();
                        }
                    } else {
                        // Desktop: original full reset behavior
                        resetRecording();
                    }
                });
            }
            if (mobileRetryBtn) {
                mobileRetryBtn.addEventListener('click', function () {
                    mobileRetryBtn.style.animation = 'spin 0.5s linear';
                    resetRecording();
                    mobileRetryBtn.style.color = 'white';
                    mobileRetryBtn.style.backgroundColor = 'var(--primary-bg)';
                    setTimeout(function () {
                        mobileRetryBtn.style.animation = '';
                    }, 500);
        });
    }
    
    function saveEntry() {
                const transcript = finalTranscript && finalTranscript.value ? finalTranscript.value.trim() : '';
                if (!transcript) {
                    window.alert('Add some text in the transcript (by speaking or typing) before saving.');
                    return;
                }
                try {
                    sessionStorage.setItem(
                        VOICE_TO_WRITE_STORAGE_KEY,
                        JSON.stringify({ text: transcript, ts: Date.now() })
                    );
                } catch (e) {
                    console.error(e);
                    window.alert('Could not prepare your entry. Try again or check private browsing settings.');
                    return;
                }
                window.location.href = 'write-entry.html';
            }

            if (saveBtn) saveBtn.addEventListener('click', saveEntry);
            if (mobileSaveBtn) mobileSaveBtn.addEventListener('click', saveEntry);

            // Mobile Tips Modal Controls
            const mobileTipsBtn = document.getElementById('mobileTipsBtn');
            const voiceTipsModal = document.getElementById('voiceTipsModal');
            const voiceTipsCloseBtn = document.getElementById('voiceTipsCloseBtn');
            const voiceTipsGotItBtn = document.getElementById('voiceTipsGotItBtn');
            const voiceTipsBackdrop = document.getElementById('voiceTipsBackdrop');

            function openTipsModal() {
                if (voiceTipsModal) voiceTipsModal.hidden = false;
            }

            function closeTipsModal() {
                if (voiceTipsModal) voiceTipsModal.hidden = true;
            }

            if (mobileTipsBtn) mobileTipsBtn.addEventListener('click', openTipsModal);
            if (voiceTipsCloseBtn) voiceTipsCloseBtn.addEventListener('click', closeTipsModal);
            if (voiceTipsGotItBtn) voiceTipsGotItBtn.addEventListener('click', closeTipsModal);
            if (voiceTipsBackdrop) voiceTipsBackdrop.addEventListener('click', closeTipsModal);
        } finally {
            if (window.DiariShell && typeof window.DiariShell.release === 'function') {
                window.DiariShell.release();
            }
        }
    });
})();
