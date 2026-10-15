/**
 * On-device speech-to-text (no DiariCore /api call).
 * English: Whisper Tiny. Filipino/Taglish: Whisper Small + tagalog language hint.
 */
(function (global) {
    'use strict';

    const pipelineByModel = Object.create(null);

    function isSupported() {
        return Boolean(global.AudioContext || global.webkitAudioContext);
    }

    function resolveVoiceLang(options) {
        if (options && (options.voiceLang === 'en' || options.voiceLang === 'tl')) {
            return options.voiceLang;
        }
        if (global.DiariVoiceLocale && typeof global.DiariVoiceLocale.getVoiceLang === 'function') {
            return global.DiariVoiceLocale.getVoiceLang();
        }
        return 'en';
    }

    function modelAndLanguage(voiceLang) {
        if (global.DiariVoiceLocale) {
            return {
                modelId: global.DiariVoiceLocale.whisperModelId(voiceLang),
                language: global.DiariVoiceLocale.whisperLanguage(voiceLang),
            };
        }
        return {
            modelId: voiceLang === 'tl' ? 'Xenova/whisper-small' : 'Xenova/whisper-tiny',
            language: voiceLang === 'tl' ? 'tagalog' : 'english',
        };
    }

    async function loadTranscriber(modelId) {
        if (!pipelineByModel[modelId]) {
            pipelineByModel[modelId] = (async function () {
                let pipeline;
                let env;
                try {
                    const mod = await import(
                        'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
                    );
                    pipeline = mod.pipeline;
                    env = mod.env;
                } catch (e) {
                    throw new Error(
                        'Could not load the on-device speech library. Check your internet connection and try again.'
                    );
                }
                env.allowLocalModels = false;
                env.useBrowserCache = true;
                return pipeline('automatic-speech-recognition', modelId);
            })();
        }
        return pipelineByModel[modelId];
    }

    async function blobToMono16k(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const Ctor = global.AudioContext || global.webkitAudioContext;
        const ctx = new Ctor();
        try {
            const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
            const length = Math.max(1, Math.ceil(decoded.duration * 16000));
            const offline = new OfflineAudioContext(1, length, 16000);
            const source = offline.createBufferSource();
            source.buffer = decoded;
            source.connect(offline.destination);
            source.start(0);
            const rendered = await offline.startRendering();
            return rendered.getChannelData(0);
        } finally {
            try {
                await ctx.close();
            } catch (_) {}
        }
    }

    /**
     * @param {Blob} blob
     * @param {{ onStatus?: (msg: string) => void, voiceLang?: 'en'|'tl' }} [options]
     * @returns {Promise<string>}
     */
    async function transcribeBlob(blob, options) {
        if (!blob || blob.size < 200) {
            throw new Error('Recording too short.');
        }
        const opts = options || {};
        const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
        const voiceLang = resolveVoiceLang(opts);
        const { modelId, language } = modelAndLanguage(voiceLang);
        const isFilipino = voiceLang === 'tl';

        if (onStatus) {
            onStatus(
                isFilipino
                    ? 'Loading Filipino speech model (first use may take 1–2 minutes)…'
                    : 'Loading on-device speech model (first use may take a minute)…'
            );
        }
        const transcriber = await loadTranscriber(modelId);
        if (onStatus) onStatus('Preparing audio…');
        const audio = await blobToMono16k(blob);
        if (onStatus) {
            onStatus(
                isFilipino
                    ? 'Transcribing in Filipino / Taglish on your device…'
                    : 'Transcribing on your device…'
            );
        }
        const out = await transcriber(audio, {
            sampling_rate: 16000,
            language: language,
            task: 'transcribe',
            chunk_length_s: 25,
            stride_length_s: 5,
        });
        let text = '';
        if (out && typeof out.text === 'string' && out.text.trim()) {
            text = out.text.trim();
        } else if (out && Array.isArray(out.chunks) && out.chunks.length) {
            // Join ALL chunks (31s+ recordings produce many). Old code only
            // kept chunks[0], dropping most of the speech.
            text = out.chunks
                .map(function (ch) {
                    if (!ch) return '';
                    if (typeof ch === 'string') return ch;
                    if (typeof ch.text === 'string') return ch.text;
                    return '';
                })
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        return text;
    }

    global.DiariVoiceClient = {
        isSupported,
        transcribeBlob,
    };
})(typeof window !== 'undefined' ? window : globalThis);
