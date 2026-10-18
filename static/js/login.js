// DiariCore Login Page JavaScript - Sliding Panel Version

document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const initialMode = (urlParams.get('mode') || '').toLowerCase();
    // Container and panels
    const loginContainer = document.getElementById('loginContainer');
    
    // Form sections
    const signinSection = document.getElementById('signinSection');
    const signupSection = document.getElementById('signupSection');
    const signinWelcome = document.getElementById('signinWelcome');
    const signupWelcome = document.getElementById('signupWelcome');
    
    // Switch buttons
    const showSignUpBtn = document.getElementById('showSignUpBtn');
    const showSignInBtn = document.getElementById('showSignInBtn');
    const mobileSwitchToSignUp = document.getElementById('mobileSwitchToSignUp');
    const mobileSwitchToSignIn = document.getElementById('mobileSwitchToSignIn');
    
    // Forms
    const loginForm = document.getElementById('loginForm');
    const signUpForm = document.getElementById('signUpForm');
    const otpSection = document.getElementById('otpSection');
    const otpEmailDisplay = document.getElementById('otpEmailDisplay');
    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const resendOtpBtn = document.getElementById('resendOtpBtn');
    const otpBackBtn = document.getElementById('otpBackBtn');
    const otpCodeError = document.getElementById('otpCode-error');
    const otpTimerLabel = document.getElementById('otpTimerLabel');
    const otpDigits = Array.from(document.querySelectorAll('.otp-digit'));
    
    // Password toggles
    const togglePassword = document.getElementById('togglePassword');
    const toggleSignUpPassword = document.getElementById('toggleSignUpPassword');
    const toggleConfirmPassword = document.getElementById('toggleConfirmPassword');
    const passwordInput = document.getElementById('password');
    const signUpPasswordInput = document.getElementById('signUpPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    
    // Google buttons
    const loginPasswordResetStep = document.getElementById('loginPasswordResetStep');
    const resetCloseBtn = document.getElementById('resetCloseBtn');
    const signinMainFormHeader = document.getElementById('signinMainFormHeader');
    const resetAlert = document.getElementById('resetAlert');
    const resetOtpFeedback = document.getElementById('resetOtpFeedback');
    const resetOtpFeedbackText = document.getElementById('resetOtpFeedbackText');
    const resetOtpFeedbackClose = document.getElementById('resetOtpFeedbackClose');
    const resetRequestForm = document.getElementById('resetRequestForm');
    const resetConfirmForm = document.getElementById('resetConfirmForm');
    const resetIdentifierInput = document.getElementById('resetIdentifier');
    const resetCodeInput = document.getElementById('resetCode');
    const resetNewPasswordInput = document.getElementById('resetNewPassword');
    const resetConfirmPasswordInput = document.getElementById('resetConfirmPassword');
    const sendResetCodeBtn = document.getElementById('sendResetCodeBtn');
    const verifyResetCodeBtn = document.getElementById('verifyResetCodeBtn');
    const resendResetCodeBtn = document.getElementById('resendResetCodeBtn');
    const resetTimerLabel = document.getElementById('resetTimerLabel');
    const resetOtpDigits = Array.from(document.querySelectorAll('#resetOtpInputs .login-totp-digit'));
    const confirmResetBtn = document.getElementById('confirmResetBtn');
    const resetVerifyBackBtn = document.getElementById('resetVerifyBackBtn');
    const resetPasswordBackBtn = document.getElementById('resetPasswordBackBtn');
    const resetPasswordForm = document.getElementById('resetPasswordForm');
    const resetSubtitle = document.getElementById('resetSubtitle');
    const resetTitle = document.getElementById('resetTitle');
    const resetToggleNewPassword = document.getElementById('resetToggleNewPassword');
    const resetToggleConfirmPassword = document.getElementById('resetToggleConfirmPassword');
    const resetPwLive = document.getElementById('resetPwLive');
    const resetPwCommonErr = document.getElementById('resetPassword-common-error');
    let resetPwLiveInst = null;
    let pendingRegistrationEmail = '';
    let otpTimerInterval = null;
    let otpExpirySeconds = 0;
    let resetIdentifier = '';
    let verifiedResetCode = '';
    let resetResendInterval = null;
    let resetResendRemaining = 0;
    let resetVerifyInProgress = false;
    let resetAutoVerifyTimeout = null;
    let pendingTwoFactorToken = null;
    let loginTotpVerifyInProgress = false;
    let loginTotpAutoVerifyTimeout = null;
    let loginRecoveryAutoVerifyTimeout = null;
    const LOGIN_TOTP_VERIFY_MIN_MS = 3000;

    const signinMainFlow = document.getElementById('signinMainFlow');
    const loginTotpStep = document.getElementById('loginTotpStep');
    const loginTotpAuthenticatorPanel = document.getElementById('loginTotpAuthenticatorPanel');
    const loginTotpRecoveryPanel = document.getElementById('loginTotpRecoveryPanel');
    const loginTotpDigitsWrap = document.getElementById('loginTotpDigits');
    const loginTotpDigits = Array.from(document.querySelectorAll('#loginTotpDigits .login-totp-digit'));
    const loginRecoveryDigitsWrap = document.getElementById('loginRecoveryDigits');
    const loginRecoveryDigits = Array.from(document.querySelectorAll('#loginRecoveryDigits .login-totp-digit'));
    const loginTotpSubmit = document.getElementById('loginTotpSubmit');
    const loginTotpBack = document.getElementById('loginTotpBack');
    const loginTotpCodeError = document.getElementById('loginTotpCodeError');
    const loginTotpShowRecovery = document.getElementById('loginTotpShowRecovery');
    const loginTotpRecoverySend = document.getElementById('loginTotpRecoverySend');
    const loginTotpRecoveryVerifyMessage = document.getElementById('loginTotpRecoveryVerifyMessage');
    const loginTotpRecoveryVerifyMessageText = document.getElementById('loginTotpRecoveryVerifyMessageText');
    const loginTotpRecoveryVerifyMessageClose = document.getElementById('loginTotpRecoveryVerifyMessageClose');
    const loginTotpRecoveryRequestCard = document.getElementById('loginTotpRecoveryRequestCard');
    const loginTotpRecoveryVerifyCard = document.getElementById('loginTotpRecoveryVerifyCard');
    const loginTotpRecoveryCodeExpire = document.getElementById('loginTotpRecoveryCodeExpire');
    const loginTotpRecoveryBackToTotp = document.getElementById('loginTotpRecoveryBackToTotp');
    const loginRecoverySubmit = document.getElementById('loginRecoverySubmit');
    const loginRecoveryCodeError = document.getElementById('loginRecoveryCodeError');
    const loginTotpRecoveryIntro = document.getElementById('loginTotpRecoveryIntro');
    const loginTotpRecoveryResendBtn = document.getElementById('loginTotpRecoveryResendBtn');
    const loginTotpRecoveryResendTimer = document.getElementById('loginTotpRecoveryResendTimer');
    let loginRecoverySendCooldownTimer = null;
    let loginRecoveryVerifyInProgress = false;
    let loginRecoveryCodeExpiryTimer = null;

    var RECOVERY_SEND_IDLE_HTML =
        '<i class="bi bi-envelope" aria-hidden="true"></i><span>Email me a recovery code</span>';
    var RECOVERY_SUBMIT_IDLE_HTML =
        '<i class="bi bi-box-arrow-in-right" aria-hidden="true"></i><span>Use email code & sign in</span>';

    function setRecoverySendButtonIdleHtml() {
        if (loginTotpRecoverySend) {
            loginTotpRecoverySend.innerHTML = RECOVERY_SEND_IDLE_HTML;
        }
    }

    function setRecoverySubmitButtonIdleHtml() {
        if (loginRecoverySubmit) {
            loginRecoverySubmit.innerHTML = RECOVERY_SUBMIT_IDLE_HTML;
        }
    }

    function clearRecoveryCodeExpiryTimer() {
        if (loginRecoveryCodeExpiryTimer) {
            clearInterval(loginRecoveryCodeExpiryTimer);
            loginRecoveryCodeExpiryTimer = null;
        }
        if (loginTotpRecoveryCodeExpire) loginTotpRecoveryCodeExpire.textContent = '';
    }

    function startRecoveryCodeExpiryCountdown() {
        clearRecoveryCodeExpiryTimer();
        var ends = Date.now() + 15 * 60 * 1000;
        function tick() {
            var ms = ends - Date.now();
            if (ms <= 0) {
                if (loginTotpRecoveryCodeExpire) loginTotpRecoveryCodeExpire.textContent = 'Code expired';
                clearRecoveryCodeExpiryTimer();
                return;
            }
            var totalSec = Math.ceil(ms / 1000);
            var m = Math.floor(totalSec / 60);
            var s = totalSec % 60;
            if (loginTotpRecoveryCodeExpire) {
                loginTotpRecoveryCodeExpire.textContent =
                    'Code expires in ' + m + ':' + (s < 10 ? '0' : '') + s;
            }
        }
        tick();
        loginRecoveryCodeExpiryTimer = setInterval(tick, 1000);
    }

    function getLoginTotpCode() {
        return loginTotpDigits.map(function (d) {
            return (d.value || '').replace(/\D/g, '');
        }).join('');
    }

    function clearLoginTotpDigits() {
        if (loginTotpAutoVerifyTimeout) {
            clearTimeout(loginTotpAutoVerifyTimeout);
            loginTotpAutoVerifyTimeout = null;
        }
        loginTotpDigits.forEach(function (d) {
            d.value = '';
            d.classList.remove('error');
        });
        if (loginTotpDigitsWrap) loginTotpDigitsWrap.classList.remove('has-error');
    }

    function clearLoginTotpErrorState() {
        if (loginTotpCodeError) {
            DiariSecurity.hideInlineError(loginTotpCodeError, { restoreHidden: true });
            const t = loginTotpCodeError.querySelector('[data-inline-error-text]');
            if (t) t.textContent = 'Invalid code.';
        }
        if (loginTotpDigitsWrap) loginTotpDigitsWrap.classList.remove('has-error');
    }

    function setLoginTotpErrorState(message) {
        if (loginTotpCodeError) {
            DiariSecurity.showInlineError(loginTotpCodeError, message || 'Invalid code.');
        }
        if (loginTotpDigitsWrap) loginTotpDigitsWrap.classList.add('has-error');
    }

    function getLoginRecoveryCode() {
        return loginRecoveryDigits
            .map(function (d) {
                return (d.value || '').replace(/\D/g, '');
            })
            .join('');
    }

    function clearLoginRecoveryDigits() {
        if (loginRecoveryAutoVerifyTimeout) {
            clearTimeout(loginRecoveryAutoVerifyTimeout);
            loginRecoveryAutoVerifyTimeout = null;
        }
        loginRecoveryDigits.forEach(function (d) {
            d.value = '';
            d.classList.remove('error');
        });
        if (loginRecoveryDigitsWrap) loginRecoveryDigitsWrap.classList.remove('has-error');
    }

    function clearLoginRecoveryErrorState() {
        if (loginRecoveryCodeError) {
            DiariSecurity.hideInlineError(loginRecoveryCodeError, { restoreHidden: true });
            const t = loginRecoveryCodeError.querySelector('[data-inline-error-text]');
            if (t) t.textContent = 'Invalid code.';
        }
        if (loginRecoveryDigitsWrap) loginRecoveryDigitsWrap.classList.remove('has-error');
    }

    function setLoginRecoveryErrorState(message) {
        if (loginRecoveryCodeError) {
            DiariSecurity.showInlineError(loginRecoveryCodeError, message || 'Invalid code.');
        }
        if (loginRecoveryDigitsWrap) loginRecoveryDigitsWrap.classList.add('has-error');
    }

    function getLoginFormHeaderEl() {
        return signinMainFormHeader || null;
    }

    function setLoginTotpHeaderAuthenticator() {
        var fh = getLoginFormHeaderEl();
        if (!fh) return;
        fh.hidden = false;
        fh.innerHTML =
            '<h2 class="form-title">Two-factor Authentication</h2><p class="form-subtitle">Open your authenticator app and enter your current 6-digit code.</p>';
    }

    function setLoginFormHeaderHiddenForRecovery() {
        var fh = getLoginFormHeaderEl();
        if (fh) fh.hidden = true;
    }

    function isLoginRecoveryOtpPhase() {
        return loginTotpRecoveryVerifyCard && !loginTotpRecoveryVerifyCard.hidden;
    }

    function formatRecoveryCooldownClock(seconds) {
        var s = Math.max(0, parseInt(seconds, 10) || 0);
        var m = Math.floor(s / 60);
        var r = s % 60;
        return m + ':' + (r < 10 ? '0' : '') + r;
    }

    function resetLoginRecoveryUi() {
        if (loginRecoverySendCooldownTimer) {
            clearInterval(loginRecoverySendCooldownTimer);
            loginRecoverySendCooldownTimer = null;
        }
        clearRecoveryCodeExpiryTimer();
        if (loginTotpAuthenticatorPanel) loginTotpAuthenticatorPanel.hidden = false;
        if (loginTotpRecoveryPanel) loginTotpRecoveryPanel.hidden = true;
        if (loginTotpRecoveryRequestCard) loginTotpRecoveryRequestCard.hidden = false;
        if (loginTotpRecoveryVerifyCard) loginTotpRecoveryVerifyCard.hidden = true;
        if (loginTotpRecoveryIntro) loginTotpRecoveryIntro.hidden = false;
        if (loginTotpRecoverySend) {
            loginTotpRecoverySend.hidden = false;
            loginTotpRecoverySend.disabled = false;
            loginTotpRecoverySend.classList.remove('is-loading');
            setRecoverySendButtonIdleHtml();
        }
        if (loginTotpRecoveryResendBtn) {
            loginTotpRecoveryResendBtn.disabled = false;
            loginTotpRecoveryResendBtn.classList.remove('is-loading');
            loginTotpRecoveryResendBtn.textContent = 'Resend Code';
            loginTotpRecoveryResendBtn.removeAttribute('aria-disabled');
        }
        if (loginTotpRecoveryResendTimer) loginTotpRecoveryResendTimer.textContent = '';
        if (loginTotpRecoveryVerifyMessage) {
            loginTotpRecoveryVerifyMessage.classList.remove('show');
            loginTotpRecoveryVerifyMessage.hidden = true;
            if (loginTotpRecoveryVerifyMessageText) loginTotpRecoveryVerifyMessageText.textContent = '';
        }
        clearLoginRecoveryDigits();
        clearLoginRecoveryErrorState();
        if (loginRecoverySubmit) {
            loginRecoverySubmit.disabled = false;
            loginRecoverySubmit.classList.remove('is-loading');
            setRecoverySubmitButtonIdleHtml();
        }
        loginRecoveryDigits.forEach(function (d) {
            d.disabled = false;
        });
    }

    function showLoginTotpRecoveryPanel() {
        if (loginRecoverySendCooldownTimer) {
            clearInterval(loginRecoverySendCooldownTimer);
            loginRecoverySendCooldownTimer = null;
        }
        clearRecoveryCodeExpiryTimer();
        if (loginTotpRecoveryVerifyCard) loginTotpRecoveryVerifyCard.hidden = true;
        if (loginTotpRecoveryRequestCard) loginTotpRecoveryRequestCard.hidden = false;
        if (loginTotpRecoveryIntro) loginTotpRecoveryIntro.hidden = false;
        if (loginTotpRecoverySend) {
            loginTotpRecoverySend.hidden = false;
            loginTotpRecoverySend.disabled = false;
            loginTotpRecoverySend.classList.remove('is-loading');
            setRecoverySendButtonIdleHtml();
        }
        if (loginTotpRecoveryResendBtn) {
            loginTotpRecoveryResendBtn.disabled = false;
            loginTotpRecoveryResendBtn.classList.remove('is-loading');
            loginTotpRecoveryResendBtn.textContent = 'Resend Code';
            loginTotpRecoveryResendBtn.removeAttribute('aria-disabled');
        }
        if (loginTotpRecoveryResendTimer) loginTotpRecoveryResendTimer.textContent = '';
        if (loginTotpRecoveryVerifyMessage) {
            loginTotpRecoveryVerifyMessage.classList.remove('show');
            loginTotpRecoveryVerifyMessage.hidden = true;
            if (loginTotpRecoveryVerifyMessageText) loginTotpRecoveryVerifyMessageText.textContent = '';
        }
        clearLoginRecoveryDigits();
        clearLoginRecoveryErrorState();
        if (loginTotpAuthenticatorPanel) loginTotpAuthenticatorPanel.hidden = true;
        if (loginTotpRecoveryPanel) loginTotpRecoveryPanel.hidden = false;
        setLoginFormHeaderHiddenForRecovery();
        if (loginTotpRecoverySend) loginTotpRecoverySend.focus();
    }

    function startRecoveryResendCooldown(seconds) {
        if (loginRecoverySendCooldownTimer) clearInterval(loginRecoverySendCooldownTimer);
        var left = Math.max(1, parseInt(seconds, 10) || 55);
        function renderCooldown() {
            var otpPhase = isLoginRecoveryOtpPhase();
            if (otpPhase) {
                if (loginTotpRecoveryResendBtn) {
                    loginTotpRecoveryResendBtn.disabled = left > 0;
                    if (left > 0) {
                        loginTotpRecoveryResendBtn.setAttribute('aria-disabled', 'true');
                    } else {
                        loginTotpRecoveryResendBtn.removeAttribute('aria-disabled');
                    }
                }
                if (loginTotpRecoveryResendTimer) {
                    loginTotpRecoveryResendTimer.textContent =
                        left > 0 ? ' (' + formatRecoveryCooldownClock(left) + ')' : '';
                }
                if (loginTotpRecoverySend) loginTotpRecoverySend.disabled = true;
            } else if (loginTotpRecoverySend) {
                loginTotpRecoverySend.disabled = left > 0;
                loginTotpRecoverySend.innerHTML =
                    left > 0 ? '<span>Resend in ' + left + 's</span>' : RECOVERY_SEND_IDLE_HTML;
            }
        }
        renderCooldown();
        loginRecoverySendCooldownTimer = setInterval(function () {
            left -= 1;
            renderCooldown();
            if (left <= 0) {
                clearInterval(loginRecoverySendCooldownTimer);
                loginRecoverySendCooldownTimer = null;
                if (!isLoginRecoveryOtpPhase()) {
                    if (loginTotpRecoverySend) loginTotpRecoverySend.disabled = false;
                } else if (loginTotpRecoveryResendBtn) {
                    loginTotpRecoveryResendBtn.disabled = false;
                    loginTotpRecoveryResendBtn.removeAttribute('aria-disabled');
                }
            }
        }, 1000);
    }

    function postLoginRecoveryEmailRequest() {
        return fetch('/api/login/totp/recovery/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeToken: pendingTwoFactorToken }),
        }).then(function (res) {
            return res.json().then(function (data) {
                return { ok: res.ok, status: res.status, data: data };
            });
        });
    }

    function clearRecoverySendLoading() {
        if (!loginTotpRecoverySend) return;
        loginTotpRecoverySend.classList.remove('is-loading');
        if (loginTotpRecoverySend.hidden || isLoginRecoveryOtpPhase()) return;
        loginTotpRecoverySend.disabled = false;
        if (!loginRecoverySendCooldownTimer) {
            setRecoverySendButtonIdleHtml();
        }
    }

    function clearRecoveryResendLoading() {
        if (!loginTotpRecoveryResendBtn) return;
        loginTotpRecoveryResendBtn.classList.remove('is-loading');
        loginTotpRecoveryResendBtn.textContent = 'Resend Code';
    }

    function handleRecoveryEmailResponse(out, triggeredByResend) {
        clearRecoverySendLoading();
        clearRecoveryResendLoading();
        if (out.status === 429 && out.data && out.data.retryAfterSeconds) {
            if (!isLoginRecoveryOtpPhase() && loginTotpRecoverySend) {
                setRecoverySendButtonIdleHtml();
            }
            showNotification(out.data.error || 'Please wait before requesting another code.', 'warning');
            startRecoveryResendCooldown(out.data.retryAfterSeconds);
            return;
        }
        if (!out.ok || !out.data.success) {
            if (!isLoginRecoveryOtpPhase() && loginTotpRecoverySend) {
                loginTotpRecoverySend.disabled = false;
                setRecoverySendButtonIdleHtml();
            } else if (loginTotpRecoveryResendBtn) {
                loginTotpRecoveryResendBtn.disabled = false;
            }
            showNotification(out.data.error || 'Could not send recovery email.', 'error');
            return;
        }
        if (loginTotpRecoveryIntro) loginTotpRecoveryIntro.hidden = true;
        if (loginTotpRecoverySend) loginTotpRecoverySend.hidden = true;
        if (loginTotpRecoveryRequestCard) loginTotpRecoveryRequestCard.hidden = true;
        if (loginTotpRecoveryVerifyCard) loginTotpRecoveryVerifyCard.hidden = false;
        setLoginFormHeaderHiddenForRecovery();
        startRecoveryResendCooldown(56);
        startRecoveryCodeExpiryCountdown();
        if (loginTotpRecoveryVerifyMessage) {
            if (loginTotpRecoveryVerifyMessageText) {
                loginTotpRecoveryVerifyMessageText.textContent =
                    'We sent a 6-digit recovery code to your registered email address. Enter it below to sign in.';
            }
            loginTotpRecoveryVerifyMessage.hidden = false;
            requestAnimationFrame(() => loginTotpRecoveryVerifyMessage.classList.add('show'));
        }
        if (!triggeredByResend) {
            clearLoginRecoveryDigits();
            if (loginRecoveryDigits[0]) loginRecoveryDigits[0].focus();
        }
    }

    function submitLoginRecoveryVerification() {
        if (loginRecoveryVerifyInProgress || !pendingTwoFactorToken) return;
        var code = getLoginRecoveryCode();
        if (code.length !== 6) {
            setLoginRecoveryErrorState('Enter the 6-digit code from your email.');
            return;
        }
        clearLoginRecoveryErrorState();
        loginRecoveryVerifyInProgress = true;
        if (loginRecoverySubmit) {
            loginRecoverySubmit.classList.add('is-loading');
            loginRecoverySubmit.disabled = true;
            loginRecoverySubmit.innerHTML =
                '<span class="login-totp-verify-spinner" aria-hidden="true"></span><span>Signing in...</span>';
        }
        loginRecoveryDigits.forEach(function (d) {
            d.disabled = true;
        });
        fetch('/api/login/totp/recovery/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeToken: pendingTwoFactorToken, code: code }),
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (_refR) {
                var okR = _refR.ok;
                var dataR = _refR.data;
                if (!okR || !dataR.success) {
                    loginRecoveryVerifyInProgress = false;
                    if (loginRecoverySubmit) {
                        loginRecoverySubmit.classList.remove('is-loading');
                        loginRecoverySubmit.disabled = false;
                        setRecoverySubmitButtonIdleHtml();
                    }
                    loginRecoveryDigits.forEach(function (d) {
                        d.disabled = false;
                    });
                    setLoginRecoveryErrorState(dataR.error || 'Invalid or expired recovery code.');
                    clearLoginRecoveryDigits();
                    if (loginRecoveryDigits[0]) loginRecoveryDigits[0].focus();
                    return;
                }
                loginRecoveryVerifyInProgress = false;
                if (loginRecoverySubmit) {
                    loginRecoverySubmit.classList.remove('is-loading');
                    loginRecoverySubmit.disabled = false;
                    setRecoverySubmitButtonIdleHtml();
                }
                loginRecoveryDigits.forEach(function (d) {
                    d.disabled = false;
                });
                showLoginCredentialsStep();
                if (dataR.totpWasReset) {
                    showNotification(
                        'Authenticator sign-in was reset. You can turn it on again in Profile → Security.',
                        'info'
                    );
                }
                finishSuccessfulLogin(dataR.user, dataR);
            })
            .catch(function () {
                loginRecoveryVerifyInProgress = false;
                if (loginRecoverySubmit) {
                    loginRecoverySubmit.classList.remove('is-loading');
                    loginRecoverySubmit.disabled = false;
                    setRecoverySubmitButtonIdleHtml();
                }
                loginRecoveryDigits.forEach(function (d) {
                    d.disabled = false;
                });
                showNotification('Could not reach the server. Please try again.', 'error');
            });
    }

    function setLoginTotpSubmitIdle() {
        if (!loginTotpSubmit) return;
        loginTotpSubmit.classList.remove('is-loading');
        loginTotpSubmit.disabled = false;
        loginTotpSubmit.textContent = 'VERIFY & CONTINUE';
        loginTotpDigits.forEach(function (d) {
            d.disabled = false;
        });
    }

    function setLoginTotpSubmitVerifying() {
        if (!loginTotpSubmit) return;
        loginTotpSubmit.classList.add('is-loading');
        loginTotpSubmit.disabled = true;
        loginTotpSubmit.innerHTML =
            '<span class="login-totp-verify-spinner" aria-hidden="true"></span><span>Verifying...</span>';
        loginTotpDigits.forEach(function (d) {
            d.disabled = true;
        });
    }

    function scheduleLoginTotpAutoVerify() {
        if (loginTotpAutoVerifyTimeout) clearTimeout(loginTotpAutoVerifyTimeout);
        loginTotpAutoVerifyTimeout = setTimeout(function () {
            loginTotpAutoVerifyTimeout = null;
            if (getLoginTotpCode().length === 6) {
                submitLoginTotpVerification(true);
            }
        }, 240);
    }

    function scheduleLoginRecoveryAutoVerify() {
        if (loginRecoveryAutoVerifyTimeout) clearTimeout(loginRecoveryAutoVerifyTimeout);
        loginRecoveryAutoVerifyTimeout = setTimeout(function () {
            loginRecoveryAutoVerifyTimeout = null;
            if (getLoginRecoveryCode().length === 6 && !loginRecoveryVerifyInProgress) {
                submitLoginRecoveryVerification();
            }
        }, 240);
    }

    function submitLoginTotpVerification(fromAuto) {
        if (loginTotpVerifyInProgress) return;
        var code = getLoginTotpCode();
        if (!pendingTwoFactorToken) {
            if (!fromAuto) {
                showNotification('Please sign in with your password again.', 'warning');
                showLoginCredentialsStep();
            }
            return;
        }
        if (code.length !== 6) {
            if (!fromAuto) {
                setLoginTotpErrorState('Enter the 6-digit code from your authenticator app.');
            }
            return;
        }
        clearLoginTotpErrorState();
        loginTotpVerifyInProgress = true;
        var verifyStarted = Date.now();
        setLoginTotpSubmitVerifying();
        fetch('/api/login/totp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeToken: pendingTwoFactorToken, code: code }),
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (_ref) {
                var ok = _ref.ok;
                var data = _ref.data;
                if (!ok || !data.success) {
                    loginTotpVerifyInProgress = false;
                    setLoginTotpSubmitIdle();
                    setLoginTotpErrorState(data.error || 'Invalid code.');
                    clearLoginTotpDigits();
                    if (loginTotpDigits[0]) loginTotpDigits[0].focus();
                    return null;
                }
                var elapsed = Date.now() - verifyStarted;
                var wait = Math.max(0, LOGIN_TOTP_VERIFY_MIN_MS - elapsed);
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        resolve(data);
                    }, wait);
                });
            })
            .then(function (data) {
                if (!data || !data.success || !data.user) return;
                loginTotpVerifyInProgress = false;
                setLoginTotpSubmitIdle();
                showLoginCredentialsStep();
                finishSuccessfulLogin(data.user, data);
            })
            .catch(function () {
                loginTotpVerifyInProgress = false;
                setLoginTotpSubmitIdle();
                showNotification('Could not reach the server. Please try again.', 'error');
            });
    }
    
    // Switch to Sign Up mode
    function switchToSignUp() {
        loginContainer.classList.add('signup-mode');
        if (otpSection) otpSection.classList.add('hidden');
        if (signupSection) signupSection.classList.remove('hidden');
        
        // Fade out current content
        signinSection.style.opacity = '0';
        signinWelcome.style.opacity = '0';
        signupWelcome.classList.add('hidden');
        
        setTimeout(() => {
            signinSection.classList.add('hidden');
            signupSection.classList.remove('hidden');
            signinWelcome.classList.add('hidden');
            signupWelcome.classList.remove('hidden');
            
            // Fade in new content
            signupSection.style.opacity = '0';
            signupWelcome.style.opacity = '0';
            
            setTimeout(() => {
                signupSection.style.opacity = '1';
                signupWelcome.style.opacity = '1';
            }, 50);
        }, 300);
    }
    
    // Switch to Sign In mode
    function switchToSignIn() {
        // Hide signup welcome immediately to prevent flash during panel swap
        signupWelcome.classList.add('hidden');
        signupWelcome.style.opacity = '0';
        if (otpTimerInterval) {
            clearInterval(otpTimerInterval);
            otpTimerInterval = null;
        }
        if (otpSection) otpSection.classList.add('hidden');
        if (signupSection) signupSection.classList.remove('hidden');
        loginContainer.classList.remove('signup-mode');
        
        // Fade out current content
        signupSection.style.opacity = '0';
        signinWelcome.classList.add('hidden');
        
        setTimeout(() => {
            signupSection.classList.add('hidden');
            signinSection.classList.remove('hidden');
            signupWelcome.classList.add('hidden');
            signinWelcome.classList.remove('hidden');
            
            // Fade in new content
            signinSection.style.opacity = '0';
            signinWelcome.style.opacity = '0';
            
            setTimeout(() => {
                signinSection.style.opacity = '1';
                signinWelcome.style.opacity = '1';
            }, 50);
        }, 300);
    }
    
    // Event listeners for switching
    if (showSignUpBtn) {
        showSignUpBtn.addEventListener('click', switchToSignUp);
    }
    
    if (showSignInBtn) {
        showSignInBtn.addEventListener('click', switchToSignIn);
    }
    
    if (mobileSwitchToSignUp) {
        mobileSwitchToSignUp.addEventListener('click', function(e) {
            e.preventDefault();
            switchToSignUp();
        });
    }
    
    if (mobileSwitchToSignIn) {
        mobileSwitchToSignIn.addEventListener('click', function(e) {
            e.preventDefault();
            switchToSignIn();
        });
    }
    
    // Password toggle functionality
    function setupPasswordToggle(toggleBtn, passwordField) {
        if (toggleBtn && passwordField) {
            toggleBtn.addEventListener('click', function() {
                const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
                passwordField.setAttribute('type', type);
                
                // Toggle icon
                this.classList.toggle('bi-eye');
                this.classList.toggle('bi-eye-slash');
            });
        }
    }
    
    setupPasswordToggle(togglePassword, passwordInput);
    setupPasswordToggle(toggleSignUpPassword, signUpPasswordInput);
    setupPasswordToggle(toggleConfirmPassword, confirmPasswordInput);
    setupPasswordToggle(resetToggleNewPassword, resetNewPasswordInput);
    setupPasswordToggle(resetToggleConfirmPassword, resetConfirmPasswordInput);
    
    // Email validation
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    function showOtpError(message) {
        if (!otpCodeError) return;
        otpCodeError.textContent = message;
        otpCodeError.classList.add('show');
    }

    function hideOtpError() {
        if (!otpCodeError) return;
        otpCodeError.classList.remove('show');
    }

    function getOtpCode() {
        return otpDigits.map((d) => d.value).join('');
    }

    function updateOtpButtonState() {
        if (!verifyOtpBtn) return;
        verifyOtpBtn.disabled = getOtpCode().length !== 6;
    }

    function resetRegistrationOtpInputs() {
        otpDigits.forEach((d) => {
            d.value = '';
            d.classList.remove('error');
        });
        updateOtpButtonState();
        hideOtpError();
        if (otpDigits[0]) otpDigits[0].focus();
    }

    function startOtpCountdown(seconds) {
        otpExpirySeconds = seconds;
        if (otpTimerInterval) clearInterval(otpTimerInterval);
        const render = () => {
            const m = Math.floor(otpExpirySeconds / 60);
            const s = otpExpirySeconds % 60;
            if (otpTimerLabel) otpTimerLabel.textContent = `Code expires in ${m}:${String(s).padStart(2, '0')}`;
        };
        render();
        otpTimerInterval = setInterval(() => {
            otpExpirySeconds -= 1;
            if (otpExpirySeconds <= 0) {
                clearInterval(otpTimerInterval);
                if (otpTimerLabel) otpTimerLabel.textContent = 'Code expired. Resend a new one.';
                return;
            }
            render();
        }, 1000);
    }

    function showOtpSection(email) {
        pendingRegistrationEmail = email;
        if (otpEmailDisplay) otpEmailDisplay.textContent = email;
        signupSection.classList.add('hidden');
        if (otpSection) otpSection.classList.remove('hidden');
        resetRegistrationOtpInputs();
        startOtpCountdown(10 * 60);
    }

    const availabilityState = {
        nickname: { lastCheckedValue: '', isAvailable: null, pendingPromise: null },
        signUpEmail: { lastCheckedValue: '', isAvailable: null, pendingPromise: null }
    };
    const availabilityTimers = { nickname: null, signUpEmail: null };

    function resetAvailability(fieldId) {
        if (!availabilityState[fieldId]) return;
        availabilityState[fieldId].lastCheckedValue = '';
        availabilityState[fieldId].isAvailable = null;
        availabilityState[fieldId].pendingPromise = null;
    }

    function checkFieldAvailability(fieldId, value) {
        if (!availabilityState[fieldId]) return Promise.resolve(true);
        const state = availabilityState[fieldId];

        if (state.lastCheckedValue === value && state.isAvailable !== null) {
            const el = document.getElementById(fieldId);
            if (el) {
                if (state.isAvailable) {
                    showSuccess(el);
                } else {
                    showError(
                        el,
                        fieldId === 'nickname' ? 'Username already exists.' : 'Email already exists.'
                    );
                }
            }
            return Promise.resolve(state.isAvailable);
        }
        if (state.lastCheckedValue === value && state.pendingPromise) {
            return state.pendingPromise;
        }

        const apiField = fieldId === 'nickname' ? 'nickname' : 'email';
        state.lastCheckedValue = value;
        state.isAvailable = null;

        state.pendingPromise = fetch(`/api/check-availability?field=${encodeURIComponent(apiField)}&value=${encodeURIComponent(value)}`)
            .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
            .then(({ ok, data }) => {
                if (!ok || !data.success) return true;
                if (state.lastCheckedValue !== value) return true;
                state.isAvailable = !!data.available;
                if (state.isAvailable) {
                    showSuccess(document.getElementById(fieldId));
                    return true;
                }
                showError(document.getElementById(fieldId), data.message || (fieldId === 'nickname' ? 'Username already exists.' : 'Email already exists.'));
                return false;
            })
            .catch(() => true)
            .finally(() => {
                if (state.lastCheckedValue === value) {
                    state.pendingPromise = null;
                }
            });

        return state.pendingPromise;
    }

    function scheduleAvailabilityCheck(fieldId, value) {
        if (!availabilityState[fieldId]) return;
        if (availabilityTimers[fieldId]) {
            clearTimeout(availabilityTimers[fieldId]);
        }
        availabilityTimers[fieldId] = setTimeout(() => {
            checkFieldAvailability(fieldId, value);
        }, 300);
    }
    
    // Show error message
    function showError(inputElement, message) {
        inputElement.classList.add('error');
        inputElement.classList.remove('success');

        const customError = document.getElementById(`${inputElement.id}-error`);
        if (customError) {
            DiariSecurity.showInlineError(customError, message);
            return;
        }

        let errorDiv = inputElement.parentElement.nextElementSibling;
        if (!errorDiv || !errorDiv.classList.contains('error-message')) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            inputElement.parentElement.after(errorDiv);
        }

        errorDiv.textContent = message;
        errorDiv.classList.add('show');
    }
    
    // Show success state
    function showSuccess(inputElement) {
        inputElement.classList.remove('error');
        inputElement.classList.add('success');

        const customError = document.getElementById(`${inputElement.id}-error`);
        if (customError) {
            DiariSecurity.hideInlineError(customError);
        }

        const errorDiv = inputElement.parentElement.nextElementSibling;
        if (errorDiv && errorDiv.classList.contains('error-message')) {
            errorDiv.classList.remove('show');
        }
    }
    
    // Clear validation
    function clearValidation(inputElement) {
        inputElement.classList.remove('error', 'success');
        const customError = document.getElementById(`${inputElement.id}-error`);
        if (customError) {
            DiariSecurity.hideInlineError(customError);
        }
        const errorDiv = inputElement.parentElement.nextElementSibling;
        if (errorDiv && errorDiv.classList.contains('error-message')) {
            errorDiv.classList.remove('show');
        }
    }

    function validateSignUpField(fieldId) {
        const field = document.getElementById(fieldId);
        if (!field) return true;

        const value = field.value.trim();

        if (fieldId === 'nickname') {
            if (!value) {
                resetAvailability('nickname');
                return showError(field, 'Username is required.'), false;
            }
            if (value.length < 4 || value.length > 64) {
                resetAvailability('nickname');
                return showError(field, 'Field must be between 4 and 64 characters long.'), false;
            }
            const st = availabilityState.nickname;
            if (st.lastCheckedValue === value && st.isAvailable === false) {
                showError(field, 'Username already exists.');
                return false;
            }
            if (st.lastCheckedValue === value && st.isAvailable === true) {
                showSuccess(field);
                return true;
            }
            scheduleAvailabilityCheck('nickname', value);
            return true;
        }

        if (fieldId === 'signUpEmail') {
            if (!value) {
                resetAvailability('signUpEmail');
                return showError(field, 'Email is required.'), false;
            }
            if (!isValidEmail(value)) {
                resetAvailability('signUpEmail');
                return showError(field, 'Please enter a valid email.'), false;
            }
            const stE = availabilityState.signUpEmail;
            if (stE.lastCheckedValue === value && stE.isAvailable === false) {
                showError(field, 'Email already exists.');
                return false;
            }
            if (stE.lastCheckedValue === value && stE.isAvailable === true) {
                showSuccess(field);
                return true;
            }
            scheduleAvailabilityCheck('signUpEmail', value);
            return true;
        }

        if (fieldId === 'firstName') {
            if (!value) return showError(field, 'First name is required.'), false;
            showSuccess(field); return true;
        }

        if (fieldId === 'lastName') {
            if (!value) return showError(field, 'Last name is required.'), false;
            showSuccess(field); return true;
        }

        if (fieldId === 'gender') {
            if (!value) return showError(field, 'Gender is required.'), false;
            showSuccess(field); return true;
        }

        if (fieldId === 'birthday') {
            if (!value) return showError(field, 'Date of birth is required.'), false;
            showSuccess(field); return true;
        }

        if (fieldId === 'signUpPassword') {
            if (!value) return showError(field, 'Password is required.'), false;
            showSuccess(field);
            // Re-validate confirm password when password changes
            if (document.getElementById('confirmPassword')?.value.trim()) {
                validateSignUpField('confirmPassword');
            }
            return true;
        }

        if (fieldId === 'confirmPassword') {
            const pass = document.getElementById('signUpPassword').value;
            if (!value) return showError(field, 'Password confirmation is required.'), false;
            if (value !== pass) return clearValidation(field), false;
            showSuccess(field); return true;
        }

        return true;
    }

    function showLoginCredentialsStep() {
        pendingTwoFactorToken = null;
        loginTotpVerifyInProgress = false;
        loginRecoveryVerifyInProgress = false;
        clearAuthPhaseState();
        resetLoginRecoveryUi();
        if (loginTotpAutoVerifyTimeout) {
            clearTimeout(loginTotpAutoVerifyTimeout);
            loginTotpAutoVerifyTimeout = null;
        }
        clearLoginTotpDigits();
        clearLoginTotpErrorState();
        setLoginTotpSubmitIdle();
        if (signinMainFlow) signinMainFlow.hidden = false;
        if (loginTotpStep) loginTotpStep.hidden = true;
        if (loginPasswordResetStep) loginPasswordResetStep.hidden = true;
        if (signinMainFormHeader) {
            signinMainFormHeader.hidden = false;
            if (signinSection && signinSection.dataset.savedHeaderHtml) {
                signinMainFormHeader.innerHTML = signinSection.dataset.savedHeaderHtml;
            }
        }
    }

    function showLoginTotpStep(challengeToken) {
        pendingTwoFactorToken = challengeToken;
        saveAuthPhaseState('2fa_verify', { pendingTwoFactorToken: challengeToken });
        resetLoginRecoveryUi();
        if (signinMainFlow) signinMainFlow.hidden = true;
        if (loginTotpStep) loginTotpStep.hidden = false;
        if (loginPasswordResetStep) loginPasswordResetStep.hidden = true;
        loginTotpVerifyInProgress = false;
        if (loginTotpAutoVerifyTimeout) {
            clearTimeout(loginTotpAutoVerifyTimeout);
            loginTotpAutoVerifyTimeout = null;
        }
        clearLoginTotpDigits();
        clearLoginTotpErrorState();
        setLoginTotpSubmitIdle();
        const fh = getLoginFormHeaderEl();
        if (fh && !signinSection.dataset.savedHeaderHtml) {
            signinSection.dataset.savedHeaderHtml = fh.innerHTML;
        }
        if (fh) {
            setLoginTotpHeaderAuthenticator();
        }
        if (loginTotpDigits[0]) loginTotpDigits[0].focus();
    }

    function finishSuccessfulLogin(u, loginPayload) {
        if (window.DiariSecurity && typeof window.DiariSecurity.clearUserScopedLocalData === 'function') {
            window.DiariSecurity.clearUserScopedLocalData();
        }
        const sessionUser = Object.assign({}, u, {
            isLoggedIn: true,
            loginTime: new Date().toISOString(),
        });
        localStorage.setItem('diariCoreUser', JSON.stringify(sessionUser));
        if (window.DiariSecurity && loginPayload && loginPayload.csrfToken) {
            window.DiariSecurity.setCsrfToken(loginPayload.csrfToken);
        }

        // Show immediately (not at redirect time) so the toast actually paints
        // during the sync-fetch + delay window on every flow, including 2FA.
        showNotification(
            u.isAdmin ? 'Admin login successful! Redirecting...' : 'Login successful! Redirecting...',
            'success'
        );

        function goAfterLoginHydrate() {
            if (u.isAdmin) {
                window.location.href = 'admin.html';
                return;
            }
            window.location.href = 'dashboard.html';
        }

        fetch('/api/sync/state?_=' + Date.now(), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (ref) {
                const data = ref.data || {};
                if (ref.ok && data.success) {
                    if (Array.isArray(data.entries)) {
                        localStorage.setItem('diariCoreEntries', JSON.stringify(data.entries));
                        const uid = data.user?.id ?? sessionUser.id;
                        if (uid) {
                            localStorage.setItem('diariCoreEntriesOwnerId', String(uid));
                        }
                    }
                    if (data.user) {
                        const merged = Object.assign({}, sessionUser, data.user, {
                            isLoggedIn: true,
                            loginTime: sessionUser.loginTime,
                        });
                        localStorage.setItem('diariCoreUser', JSON.stringify(merged));
                    }
                    if (data.syncRevision) {
                        localStorage.setItem('diariCoreSyncRevision', String(data.syncRevision));
                    }
                }
            })
            .catch(function () {
                /* redirect anyway; app page will pull again */
            })
            .finally(function () {
                setTimeout(goAfterLoginHydrate, u.isAdmin ? 400 : 700);
            });
    }
    
    var lockoutTimerInterval = null;
    var currentLockedAccount = '';

    function formatCountdownTime(totalSeconds) {
        var mins = Math.floor(totalSeconds / 60);
        var secs = totalSeconds % 60;
        return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    function startLoginLockout(remainingSeconds, targetAccount) {
        var banner = document.getElementById('loginLockoutBanner');
        var countdownEl = document.getElementById('lockoutCountdownText');
        var passwordField = document.getElementById('password');
        var submitBtn = loginForm ? loginForm.querySelector('.btn-signin') : null;

        var account = (targetAccount || currentLockedAccount || '').trim().toLowerCase();
        currentLockedAccount = account;

        if (lockoutTimerInterval) {
            clearInterval(lockoutTimerInterval);
            lockoutTimerInterval = null;
        }

        var expiresAt = Date.now() + (remainingSeconds * 1000);
        try {
            sessionStorage.setItem('diari_login_lockout_data', JSON.stringify({
                account: account,
                expiresAt: expiresAt
            }));
        } catch (_) {}

        if (banner) {
            banner.hidden = false;
        }

        if (passwordField) {
            passwordField.disabled = true;
            passwordField.value = '';
        }

        function updateTimer() {
            var diffMs = expiresAt - Date.now();
            var leftSec = Math.max(0, Math.ceil(diffMs / 1000));

            if (countdownEl) {
                countdownEl.textContent = formatCountdownTime(leftSec);
            }
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'LOCKED (' + formatCountdownTime(leftSec) + ')';
            }

            if (leftSec <= 0) {
                endLoginLockout();
            }
        }

        updateTimer();
        lockoutTimerInterval = setInterval(updateTimer, 1000);
    }

    function pauseLoginLockoutUi() {
        if (lockoutTimerInterval) {
            clearInterval(lockoutTimerInterval);
            lockoutTimerInterval = null;
        }
        var banner = document.getElementById('loginLockoutBanner');
        var passwordField = document.getElementById('password');
        var submitBtn = loginForm ? loginForm.querySelector('.btn-signin') : null;

        if (banner) banner.hidden = true;
        if (passwordField) passwordField.disabled = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'SIGN IN';
        }
    }

    function endLoginLockout() {
        if (lockoutTimerInterval) {
            clearInterval(lockoutTimerInterval);
            lockoutTimerInterval = null;
        }
        currentLockedAccount = '';
        try {
            sessionStorage.removeItem('diari_login_lockout_data');
            sessionStorage.removeItem('diari_login_lockout_until');
        } catch (_) {}

        pauseLoginLockoutUi();
        clearSignInValidation();
    }

    // Keep the active lockout banner visible until the countdown expires. It should only
    // reappear when the user re-attempts sign-in and the server confirms the account is locked.
    function clearSignInValidation() {
        const usernameField = document.getElementById('email');
        const passwordField = document.getElementById('password');
        if (usernameField) clearValidation(usernameField);
        if (passwordField) clearValidation(passwordField);
    }

    // Login form submission
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const username = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            
            clearSignInValidation();

            if (!username || !password) {
                return;
            }

            const submitBtn = loginForm.querySelector('.btn-signin');
            submitBtn.textContent = 'Signing In...';
            submitBtn.disabled = true;
            
            fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            })
                .then((res) => res.json().then((data) => ({ ok: res.ok, status: res.status, data })))
                .then(({ ok, status, data }) => {
                    if (!ok || !data.success) {
                        const usernameField = document.getElementById('email');
                        const passwordField = document.getElementById('password');

                        if (data.locked) {
                            const retryAfter = data.retryAfter || data.lockoutSeconds || 900;
                            startLoginLockout(retryAfter, username);
                            return;
                        }

                        if (status === 401) {
                            if (usernameField) {
                                usernameField.classList.add('error');
                                usernameField.classList.remove('success');
                                const usernameError = document.getElementById('email-error');
                                if (usernameError) DiariSecurity.hideInlineError(usernameError);
                            }
                            if (passwordField) {
                                passwordField.value = '';
                                const errMsg = data.error || 'Incorrect username or password.';
                                showError(passwordField, errMsg);
                                passwordField.focus();
                            }
                        } else {
                            showNotification(data.error || 'Something went wrong. Please try again.', 'error');
                        }
                        submitBtn.textContent = 'SIGN IN';
                        submitBtn.disabled = false;
                        return;
                    }

                    endLoginLockout();

                    if (data.requiresTwoFactor && data.challengeToken) {
                        submitBtn.textContent = 'SIGN IN';
                        submitBtn.disabled = false;
                        showLoginTotpStep(data.challengeToken);
                        return;
                    }
                    const u = data.user;
                    finishSuccessfulLogin(u, data);
                })
                .catch(() => {
                    showNotification('Could not reach the server. Run the DiariCore app (Flask) or check your connection.', 'error');
                    submitBtn.textContent = 'SIGN IN';
                    submitBtn.disabled = false;
                });
        });
    }

    if (loginTotpBack) {
        loginTotpBack.addEventListener('click', function () {
            showLoginCredentialsStep();
        });
    }

    if (loginTotpDigits.length) {
        loginTotpDigits.forEach(function (input, idx) {
            input.addEventListener('input', function (e) {
                var v = (e.target.value || '').replace(/\D/g, '').slice(-1);
                e.target.value = v;
                clearLoginTotpErrorState();
                if (v && idx < loginTotpDigits.length - 1) {
                    loginTotpDigits[idx + 1].focus();
                }
                if (getLoginTotpCode().length === 6) {
                    scheduleLoginTotpAutoVerify();
                }
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !input.value && idx > 0) {
                    loginTotpDigits[idx - 1].focus();
                }
                if (e.key === 'Enter' && getLoginTotpCode().length === 6 && !loginTotpVerifyInProgress) {
                    e.preventDefault();
                    submitLoginTotpVerification(false);
                }
            });
            input.addEventListener('paste', function (e) {
                e.preventDefault();
                var digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
                loginTotpDigits.forEach(function (d, i) {
                    d.value = digits[i] || '';
                });
                clearLoginTotpErrorState();
                var next = digits.length >= 6 ? 5 : digits.length;
                if (loginTotpDigits[next]) loginTotpDigits[next].focus();
                if (getLoginTotpCode().length === 6) {
                    scheduleLoginTotpAutoVerify();
                }
            });
        });
    }

    if (loginTotpSubmit) {
        loginTotpSubmit.addEventListener('click', function () {
            submitLoginTotpVerification(false);
        });
    }

    if (loginTotpShowRecovery) {
        loginTotpShowRecovery.addEventListener('click', function () {
            if (!pendingTwoFactorToken) return;
            clearLoginTotpErrorState();
            showLoginTotpRecoveryPanel();
        });
    }

    if (loginTotpRecoveryBackToTotp) {
        loginTotpRecoveryBackToTotp.addEventListener('click', function () {
            clearLoginRecoveryErrorState();
            resetLoginRecoveryUi();
            setLoginTotpHeaderAuthenticator();
            if (loginTotpDigits[0]) loginTotpDigits[0].focus();
        });
    }

    if (loginTotpRecoverySend) {
        loginTotpRecoverySend.addEventListener('click', function () {
            if (!pendingTwoFactorToken) {
                showNotification('Please sign in with your password again.', 'warning');
                return;
            }
            if (loginTotpRecoverySend.disabled || loginTotpRecoverySend.classList.contains('is-loading')) return;
            loginTotpRecoverySend.classList.add('is-loading');
            loginTotpRecoverySend.disabled = true;
            loginTotpRecoverySend.innerHTML =
                '<span class="login-totp-verify-spinner" aria-hidden="true"></span><span>Sending...</span>';
            postLoginRecoveryEmailRequest()
                .then(function (out) {
                    handleRecoveryEmailResponse(out, false);
                })
                .catch(function () {
                    clearRecoverySendLoading();
                    if (loginTotpRecoverySend) {
                        loginTotpRecoverySend.disabled = false;
                        setRecoverySendButtonIdleHtml();
                    }
                    showNotification('Could not reach the server. Please try again.', 'error');
                });
        });
    }

    if (loginTotpRecoveryResendBtn) {
        loginTotpRecoveryResendBtn.addEventListener('click', function () {
            if (!pendingTwoFactorToken) {
                showNotification('Please sign in with your password again.', 'warning');
                return;
            }
            if (!isLoginRecoveryOtpPhase()) return;
            if (loginTotpRecoveryResendBtn.disabled || loginTotpRecoveryResendBtn.classList.contains('is-loading')) return;
            if (loginTotpRecoveryResendTimer) loginTotpRecoveryResendTimer.textContent = '';
            loginTotpRecoveryResendBtn.classList.add('is-loading');
            loginTotpRecoveryResendBtn.disabled = true;
            loginTotpRecoveryResendBtn.innerHTML =
                '<span class="login-totp-recovery-resend-spinner" aria-hidden="true"></span><span>Sending...</span>';
            postLoginRecoveryEmailRequest()
                .then(function (out) {
                    handleRecoveryEmailResponse(out, true);
                })
                .catch(function () {
                    clearRecoveryResendLoading();
                    if (loginTotpRecoveryResendBtn) loginTotpRecoveryResendBtn.disabled = false;
                    showNotification('Could not reach the server. Please try again.', 'error');
                });
        });
    }

    if (loginRecoveryDigits.length) {
        loginRecoveryDigits.forEach(function (input, idx) {
            input.addEventListener('input', function (e) {
                var v = (e.target.value || '').replace(/\D/g, '').slice(-1);
                e.target.value = v;
                clearLoginRecoveryErrorState();
                if (v && idx < loginRecoveryDigits.length - 1) {
                    loginRecoveryDigits[idx + 1].focus();
                }
                if (getLoginRecoveryCode().length === 6) {
                    scheduleLoginRecoveryAutoVerify();
                }
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !input.value && idx > 0) {
                    loginRecoveryDigits[idx - 1].focus();
                }
                if (e.key === 'Enter' && getLoginRecoveryCode().length === 6 && !loginRecoveryVerifyInProgress) {
                    e.preventDefault();
                    submitLoginRecoveryVerification();
                }
            });
            input.addEventListener('paste', function (e) {
                e.preventDefault();
                var digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
                loginRecoveryDigits.forEach(function (d, i) {
                    d.value = digits[i] || '';
                });
                clearLoginRecoveryErrorState();
                var next = digits.length >= 6 ? 5 : digits.length;
                if (loginRecoveryDigits[next]) loginRecoveryDigits[next].focus();
                if (getLoginRecoveryCode().length === 6) {
                    scheduleLoginRecoveryAutoVerify();
                }
            });
        });
    }

    if (loginRecoverySubmit) {
        loginRecoverySubmit.addEventListener('click', function () {
            submitLoginRecoveryVerification();
        });
    }

    const signInUsernameField = document.getElementById('email');
    const signInPasswordField = document.getElementById('password');

    if (signInUsernameField) {
        signInUsernameField.addEventListener('input', clearSignInValidation);
    }
    if (signInPasswordField) {
        signInPasswordField.addEventListener('input', clearSignInValidation);
    }
    
    // Sign up form submission
    if (signUpForm) {
        signUpForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const nickname = document.getElementById('nickname').value.trim();
            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();
            const gender = document.getElementById('gender').value;
            const birthday = document.getElementById('birthday').value;
            const email = document.getElementById('signUpEmail').value.trim();
            const password = document.getElementById('signUpPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            let isValid = true;
            
            // Validate nickname
            if (!nickname) {
                showError(document.getElementById('nickname'), 'Username is required.');
                isValid = false;
            } else if (nickname.length < 4 || nickname.length > 64) {
                showError(document.getElementById('nickname'), 'Field must be between 4 and 64 characters long.');
                isValid = false;
            }

            // Validate first name
            if (!firstName) {
                showError(document.getElementById('firstName'), 'First name is required.');
                isValid = false;
            } else {
                showSuccess(document.getElementById('firstName'));
            }

            // Validate last name
            if (!lastName) {
                showError(document.getElementById('lastName'), 'Last name is required.');
                isValid = false;
            } else {
                showSuccess(document.getElementById('lastName'));
            }

            // Validate gender
            if (!gender) {
                showError(document.getElementById('gender'), 'Gender is required.');
                isValid = false;
            } else {
                showSuccess(document.getElementById('gender'));
            }

            // Validate birthday
            if (!birthday) {
                showError(document.getElementById('birthday'), 'Date of birth is required.');
                isValid = false;
            } else {
                showSuccess(document.getElementById('birthday'));
            }
            
            // Validate email
            if (!email) {
                showError(document.getElementById('signUpEmail'), 'Email is required.');
                isValid = false;
            } else if (!isValidEmail(email)) {
                showError(document.getElementById('signUpEmail'), 'Please enter a valid email.');
                isValid = false;
            }
            
            // Validate password
            if (!password) {
                showError(document.getElementById('signUpPassword'), 'Password is required.');
                isValid = false;
            } else {
                showSuccess(document.getElementById('signUpPassword'));
            }

            // Validate confirm password
            if (!confirmPassword) {
                showError(document.getElementById('confirmPassword'), 'Password confirmation is required.');
                isValid = false;
            } else if (confirmPassword !== password) {
                clearValidation(document.getElementById('confirmPassword'));
                isValid = false;
            } else {
                showSuccess(document.getElementById('confirmPassword'));
            }

            const personalEmbed = { nickname, email, firstName, lastName };
            if (
                window.DiariPasswordPolicy &&
                !window.DiariPasswordPolicy.isPasswordSubmitReady(password, confirmPassword, personalEmbed)
            ) {
                showNotification('Please meet all password requirements before signing up.', 'warning');
                isValid = false;
            }

            if (!navigator.onLine) {
                showNotification('You must be online to create or reset your password.', 'error');
                isValid = false;
            }
            if (isValid) {
                const nicknameAvailable = await checkFieldAvailability('nickname', nickname);
                const emailAvailable = await checkFieldAvailability('signUpEmail', email);
                if (!nicknameAvailable || !emailAvailable) {
                    return;
                }

                const submitBtn = signUpForm.querySelector('.btn-signin');
                submitBtn.textContent = 'Sending Code...';
                submitBtn.disabled = true;
                
                fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nickname: nickname,
                        email: email,
                        password: password,
                        firstName: firstName,
                        lastName: lastName,
                        gender: gender,
                        birthday: birthday
                    })
                })
                    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                    .then(({ ok, data }) => {
                        if (!data.success) {
                            if (data.field) {
                                const el = document.getElementById(data.field);
                                if (el) {
                                    showError(el, data.error || 'Invalid value');
                                } else {
                                    showNotification(data.error || 'Registration failed', 'error');
                                }
                            } else {
                                showNotification(data.error || 'Registration failed', 'error');
                            }
                            submitBtn.textContent = 'SIGN UP';
                            submitBtn.disabled = false;
                            return;
                        }
                        const pendingEmail = data.email || email;
                        sessionStorage.setItem('pendingRegistrationEmail', pendingEmail);
                        showNotification(data.message || 'Verification code sent to your email.', 'success');
                        submitBtn.textContent = 'SIGN UP';
                        submitBtn.disabled = false;
                        setTimeout(() => {
                            window.location.href = `verify-registration.html?email=${encodeURIComponent(pendingEmail)}`;
                        }, 450);
                    })
                    .catch(() => {
                        showNotification('Could not reach the server. Run the DiariCore app (Flask) or check your connection.', 'error');
                        submitBtn.textContent = 'SIGN UP';
                        submitBtn.disabled = false;
                    });
            }
        });
    }

    if (otpDigits.length) {
        otpDigits.forEach((input, idx) => {
            input.addEventListener('input', (e) => {
                const v = e.target.value.replace(/\D/g, '').slice(-1);
                e.target.value = v;
                e.target.classList.remove('error');
                hideOtpError();
                if (v && idx < otpDigits.length - 1) {
                    otpDigits[idx + 1].focus();
                }
                updateOtpButtonState();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !input.value && idx > 0) {
                    otpDigits[idx - 1].focus();
                }
            });
            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
                otpDigits.forEach((d, i) => {
                    d.value = digits[i] || '';
                });
                updateOtpButtonState();
            });
        });
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', () => {
            const otpCode = getOtpCode();
            if (otpCode.length !== 6) {
                showOtpError('Please enter the 6-digit code.');
                otpDigits.forEach((d) => d.classList.add('error'));
                return;
            }
            verifyOtpBtn.disabled = true;
            verifyOtpBtn.textContent = 'Verifying...';
            fetch('/api/register/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pendingRegistrationEmail, otpCode })
            })
                .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) {
                        showOtpError(data.error || 'Invalid verification code.');
                        otpDigits.forEach((d) => d.classList.add('error'));
                        verifyOtpBtn.disabled = false;
                        verifyOtpBtn.textContent = 'VERIFY CODE';
                        return;
                    }
                    const u = data.user;
                    if (window.DiariSecurity && typeof window.DiariSecurity.clearUserScopedLocalData === 'function') {
                        window.DiariSecurity.clearUserScopedLocalData();
                    }
                    localStorage.setItem('diariCoreUser', JSON.stringify({
                        ...u,
                        isLoggedIn: true,
                        loginTime: new Date().toISOString()
                    }));
                    if (window.DiariSecurity && data.csrfToken) {
                        window.DiariSecurity.setCsrfToken(data.csrfToken);
                    }
                    showNotification('Account verified successfully! Redirecting...', 'success');
                    setTimeout(() => {
                        if (u.isAdmin) {
                            window.location.href = 'admin.html';
                        } else {
                            window.location.href = 'dashboard.html';
                        }
                    }, 700);
                })
                .catch(() => {
                    showOtpError('Could not verify right now. Please try again.');
                    verifyOtpBtn.disabled = false;
                    verifyOtpBtn.textContent = 'VERIFY CODE';
                });
        });
    }

    if (resendOtpBtn) {
        resendOtpBtn.addEventListener('click', () => {
            if (!pendingRegistrationEmail || resendOtpBtn.disabled) return;
            resendOtpBtn.disabled = true;
            fetch('/api/register/resend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pendingRegistrationEmail })
            })
                .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) {
                        showOtpError(data.error || 'Failed to resend code.');
                        return;
                    }
                    showNotification('Verification code resent.', 'success');
                    resetRegistrationOtpInputs();
                    startOtpCountdown(10 * 60);
                })
                .catch(() => showOtpError('Failed to resend code.'))
                .finally(() => {
                    setTimeout(() => {
                        resendOtpBtn.disabled = false;
                    }, 1200);
                });
        });
    }

    if (otpBackBtn) {
        otpBackBtn.addEventListener('click', () => {
            if (otpTimerInterval) {
                clearInterval(otpTimerInterval);
                otpTimerInterval = null;
            }
            if (otpSection) otpSection.classList.add('hidden');
            signupSection.classList.remove('hidden');
            hideOtpError();
        });
    }
    
    function setResetAlert(message, type = 'error') {
        if (!resetAlert) return;
        resetAlert.textContent = message;
        resetAlert.className = `reset-alert ${type}`;
        resetAlert.hidden = false;
    }

    function clearResetAlert() {
        if (!resetAlert) return;
        resetAlert.hidden = true;
        resetAlert.textContent = '';
        resetAlert.className = 'reset-alert';
    }

    function setResetOtpFeedback(message, type) {
        if (!resetOtpFeedback || !resetOtpFeedbackText) return;
        resetOtpFeedbackText.textContent = message;
        resetOtpFeedback.className =
            'reset-otp-feedback otp-msg otp-msg--' + (type === 'success' ? 'success' : 'error');
        resetOtpFeedback.hidden = false;
        requestAnimationFrame(() => resetOtpFeedback.classList.add('show'));
    }

    function clearResetOtpFeedback() {
        if (!resetOtpFeedback) return;
        resetOtpFeedback.classList.remove('show');
        resetOtpFeedback.hidden = true;
        resetOtpFeedbackText.textContent = '';
        resetOtpFeedback.className = 'reset-otp-feedback otp-msg';
    }

    function clearResetOtpErrorFeedback() {
        if (!resetOtpFeedback || resetOtpFeedback.hidden) return;
        if (resetOtpFeedback.classList.contains('otp-msg--success')) return;
        clearResetOtpFeedback();
    }

    function clearForgotPasswordOtpInputs() {
        if (resetAutoVerifyTimeout) {
            clearTimeout(resetAutoVerifyTimeout);
            resetAutoVerifyTimeout = null;
        }
        resetOtpDigits.forEach((d) => {
            d.value = '';
        });
    }

    function getResetOtpCode() {
        return resetOtpDigits.map((d) => d.value).join('');
    }

    function setVerifyResetButtonLoading(isLoading) {
        if (!verifyResetCodeBtn) return;
        verifyResetCodeBtn.disabled = isLoading;
        verifyResetCodeBtn.classList.toggle('is-loading', isLoading);
        if (isLoading) {
            verifyResetCodeBtn.innerHTML = '<span class="reset-btn-spinner" aria-hidden="true"></span><span>Verifying...</span>';
            return;
        }
        verifyResetCodeBtn.textContent = 'Verify Code';
    }

    function saveAuthPhaseState(phase, extra = {}) {
        try {
            if (!phase || phase === 'signin') {
                sessionStorage.removeItem('auth_modal_phase_state');
            } else {
                sessionStorage.setItem('auth_modal_phase_state', JSON.stringify({
                    phase,
                    resetIdentifier: resetIdentifier || extra.resetIdentifier || '',
                    verifiedResetCode: verifiedResetCode || extra.verifiedResetCode || '',
                    pendingTwoFactorToken: pendingTwoFactorToken || extra.pendingTwoFactorToken || '',
                    timestamp: Date.now()
                }));
            }
        } catch (e) {}
    }

    function clearAuthPhaseState() {
        try {
            sessionStorage.removeItem('auth_modal_phase_state');
        } catch (e) {}
    }

    function submitResetCodeVerification() {
        if (resetVerifyInProgress) return;
        const code = getResetOtpCode();
        if (code.length !== 6) {
            setResetOtpFeedback('Please enter the 6-digit reset code.', 'error');
            return;
        }

        resetVerifyInProgress = true;
        setVerifyResetButtonLoading(true);

        fetch('/api/password/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: resetIdentifier || (resetIdentifierInput?.value || '').trim(), code })
        })
            .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
            .then(({ ok, data }) => {
                if (!ok || !data.success) {
                    setResetOtpFeedback(data.error || 'Invalid or expired reset code.', 'error');
                    return;
                }
                verifiedResetCode = code;
                saveAuthPhaseState('reset_password', { resetIdentifier, verifiedResetCode: code });
                if (resetConfirmForm) resetConfirmForm.hidden = true;
                if (resetPasswordForm) showResetStep(resetPasswordForm);
                if (resetTitle) resetTitle.textContent = 'Reset Password';
                if (resetSubtitle) resetSubtitle.textContent = 'Please choose a new password that is different from your old one.';
                clearResetOtpFeedback();
                setResetAlert('Code verified. Set your new password.', 'success');
                initResetPasswordLive();
            })
            .catch(() => setResetOtpFeedback('Could not reach the server. Please try again.', 'error'))
            .finally(() => {
                resetVerifyInProgress = false;
                setVerifyResetButtonLoading(false);
            });
    }

    function startResetResendCooldown(seconds = 57) {
        resetResendRemaining = seconds;
        if (resetResendInterval) clearInterval(resetResendInterval);
        const render = () => {
            const m = Math.floor(resetResendRemaining / 60);
            const s = resetResendRemaining % 60;
            if (resetTimerLabel) {
                resetTimerLabel.textContent = `(${m}:${String(s).padStart(2, '0')})`;
            }
        };
        if (resendResetCodeBtn) resendResetCodeBtn.disabled = true;
        render();
        resetResendInterval = setInterval(() => {
            resetResendRemaining -= 1;
            if (resetResendRemaining <= 0) {
                clearInterval(resetResendInterval);
                resetResendInterval = null;
                if (resetTimerLabel) resetTimerLabel.textContent = '';
                if (resendResetCodeBtn) resendResetCodeBtn.disabled = false;
                return;
            }
            render();
        }, 1000);
    }

    function showResetStep(form) {
        if (!form) return;
        form.hidden = false;
    }

    function destroyResetPasswordLive() {
        if (resetPwLiveInst) {
            resetPwLiveInst.destroy();
            resetPwLiveInst = null;
        }
    }

    function initResetPasswordLive() {
        destroyResetPasswordLive();
        if (
            !window.DiariPasswordLive ||
            !resetNewPasswordInput ||
            !resetConfirmPasswordInput ||
            !confirmResetBtn ||
            !resetPasswordForm ||
            !resetPwLive
        ) {
            return;
        }
        resetPwLive.innerHTML = '';
        resetPwLiveInst = window.DiariPasswordLive.attach({
            passwordEl: resetNewPasswordInput,
            confirmEl: resetConfirmPasswordInput,
            hintEl: null,
            liveWrap: resetPwLive,
            submitBtn: confirmResetBtn,
            commonErrorEl: resetPwCommonErr,
            formRoot: loginPasswordResetStep || resetPasswordForm,
            getPersonal: function () {
                return {
                    nickname: '',
                    email: (resetIdentifier || (resetIdentifierInput && resetIdentifierInput.value) || '').trim(),
                    firstName: '',
                    lastName: '',
                };
            },
        });
    }

    function openResetModal() {
        if (!loginPasswordResetStep) return;
        saveAuthPhaseState('forgot_password');
        destroyResetPasswordLive();
        if (confirmResetBtn) confirmResetBtn.disabled = true;
        if (signinMainFlow) signinMainFlow.hidden = true;
        if (loginTotpStep) loginTotpStep.hidden = true;
        if (signinMainFormHeader) signinMainFormHeader.hidden = true;
        loginPasswordResetStep.hidden = false;
        resetIdentifier = '';
        verifiedResetCode = '';
        clearResetAlert();
        clearResetOtpFeedback();
        if (resetRequestForm) showResetStep(resetRequestForm);
        if (resetConfirmForm) resetConfirmForm.hidden = true;
        if (resetPasswordForm) resetPasswordForm.hidden = true;
        if (resetTitle) resetTitle.textContent = 'Forgot Your Password?';
        if (resetSubtitle) resetSubtitle.textContent = 'Enter the email associated with your account to reset your password.';
        if (resetIdentifierInput) {
            resetIdentifierInput.value = '';
            clearValidation(resetIdentifierInput);
            resetIdentifierInput.focus();
        }
        clearForgotPasswordOtpInputs();
        if (resetNewPasswordInput) {
            resetNewPasswordInput.value = '';
            clearValidation(resetNewPasswordInput);
        }
        if (resetConfirmPasswordInput) {
            resetConfirmPasswordInput.value = '';
            clearValidation(resetConfirmPasswordInput);
        }
        if (resetResendInterval) {
            clearInterval(resetResendInterval);
            resetResendInterval = null;
        }
        if (resendResetCodeBtn) resendResetCodeBtn.disabled = false;
        if (resetTimerLabel) resetTimerLabel.textContent = '';
    }

    function closeResetModal() {
        if (!loginPasswordResetStep) return;
        clearAuthPhaseState();
        destroyResetPasswordLive();
        loginPasswordResetStep.hidden = true;
        if (signinMainFlow) signinMainFlow.hidden = false;
        if (signinMainFormHeader) signinMainFormHeader.hidden = false;
        resetIdentifier = '';
        verifiedResetCode = '';
        clearResetAlert();
        clearResetOtpFeedback();
        if (resetResendInterval) {
            clearInterval(resetResendInterval);
            resetResendInterval = null;
        }
    }

    if (resetCloseBtn) resetCloseBtn.addEventListener('click', closeResetModal);

    if (resetRequestForm) {
        const validateResetIdentifierField = (isSubmit = false) => {
            if (!resetIdentifierInput) return false;
            const value = (resetIdentifierInput.value || '').trim();
            if (!value) {
                if (!isSubmit) {
                    clearValidation(resetIdentifierInput);
                    return false;
                }
                showError(resetIdentifierInput, 'Email address is required.');
                return false;
            }
            if (!isValidEmail(value)) {
                showError(resetIdentifierInput, 'Please enter a valid email.');
                return false;
            }
            clearValidation(resetIdentifierInput);
            showSuccess(resetIdentifierInput);
            return true;
        };

        if (resetIdentifierInput) {
            resetIdentifierInput.addEventListener('input', () => {
                const val = (resetIdentifierInput.value || '').trim();
                if (!val) {
                    clearValidation(resetIdentifierInput);
                } else {
                    validateResetIdentifierField(false);
                }
            });
            resetIdentifierInput.addEventListener('blur', () => {
                const val = (resetIdentifierInput.value || '').trim();
                if (!val) {
                    clearValidation(resetIdentifierInput);
                } else {
                    validateResetIdentifierField(false);
                }
            });
        }

        resetRequestForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const identifier = (resetIdentifierInput?.value || '').trim();
            if (!validateResetIdentifierField(true)) {
                return;
            }
            clearResetAlert();
            if (sendResetCodeBtn) {
                sendResetCodeBtn.disabled = true;
                sendResetCodeBtn.classList.add('is-loading');
                sendResetCodeBtn.innerHTML = '<span class="reset-btn-spinner" aria-hidden="true"></span><span>Sending Reset Code...</span>';
            }
            fetch('/api/password/forgot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, email: identifier })
            })
                .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) {
                        if (resetIdentifierInput) {
                            showError(
                                resetIdentifierInput,
                                data.error || 'This email doesn’t appear to be associated with any account yet.'
                            );
                        } else {
                            setResetAlert(data.error || 'Failed to send reset code.');
                        }
                        return;
                    }
                    if (resetIdentifierInput) {
                        clearValidation(resetIdentifierInput);
                    }
                    resetIdentifier = identifier;
                    saveAuthPhaseState('forgot_verify', { resetIdentifier: identifier });
                    if (resetRequestForm) resetRequestForm.hidden = true;
                    if (resetConfirmForm) showResetStep(resetConfirmForm);
                    if (resetTitle) resetTitle.textContent = 'Verification';
                    if (resetSubtitle) resetSubtitle.textContent = 'Thank you for verifying. Kindly check your email for the code.';
                    clearResetAlert();
                    clearResetOtpFeedback();
                    startResetResendCooldown(60);
                    if (resetOtpDigits[0]) resetOtpDigits[0].focus();
                })
                .catch(() => setResetAlert('Could not reach the server. Please try again.'))
                .finally(() => {
                    if (sendResetCodeBtn) {
                        sendResetCodeBtn.disabled = false;
                        sendResetCodeBtn.classList.remove('is-loading');
                        sendResetCodeBtn.textContent = 'Send Reset Code';
                    }
                });
        });
    }

    if (resetVerifyBackBtn) {
        resetVerifyBackBtn.addEventListener('click', function () {
            clearResetAlert();
            clearResetOtpFeedback();
            saveAuthPhaseState('forgot_password');
            destroyResetPasswordLive();
            if (resetConfirmForm) resetConfirmForm.hidden = true;
            if (resetRequestForm) showResetStep(resetRequestForm);
            if (resetPasswordForm) resetPasswordForm.hidden = true;
            if (resetTitle) resetTitle.textContent = 'Forgot Your Password?';
            if (resetSubtitle) resetSubtitle.textContent = 'Enter the email associated with your account to reset your password.';
            if (resetResendInterval) {
                clearInterval(resetResendInterval);
                resetResendInterval = null;
            }
        });
    }

    if (resetPasswordBackBtn) {
        resetPasswordBackBtn.addEventListener('click', function () {
            clearResetAlert();
            clearResetOtpFeedback();
            saveAuthPhaseState('forgot_verify', { resetIdentifier });
            destroyResetPasswordLive();
            if (resetPasswordForm) resetPasswordForm.hidden = true;
            if (resetConfirmForm) showResetStep(resetConfirmForm);
            if (resetTitle) resetTitle.textContent = 'Verification';
            if (resetSubtitle) resetSubtitle.textContent = 'Thank you for verifying. Kindly check your email for the code.';
            startResetResendCooldown(Math.max(resetResendRemaining, 20));
        });
    }

    if (resetOtpDigits.length) {
        resetOtpDigits.forEach((input, idx) => {
            input.addEventListener('input', (e) => {
                const v = e.target.value.replace(/\D/g, '').slice(-1);
                e.target.value = v;
                clearResetAlert();
                clearResetOtpErrorFeedback();
                if (v && idx < resetOtpDigits.length - 1) {
                    resetOtpDigits[idx + 1].focus();
                }
                const isComplete = getResetOtpCode().length === 6;
                if (isComplete) {
                    if (resetAutoVerifyTimeout) clearTimeout(resetAutoVerifyTimeout);
                    resetAutoVerifyTimeout = setTimeout(() => {
                        if (!resetVerifyInProgress && resetConfirmForm && !resetConfirmForm.hidden) {
                            submitResetCodeVerification();
                        }
                    }, 220);
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !input.value && idx > 0) {
                    resetOtpDigits[idx - 1].focus();
                }
                if (e.key === 'Backspace' && resetAutoVerifyTimeout) {
                    clearTimeout(resetAutoVerifyTimeout);
                    resetAutoVerifyTimeout = null;
                }
            });
            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
                resetOtpDigits.forEach((d, i) => {
                    d.value = digits[i] || '';
                });
                clearResetAlert();
                clearResetOtpErrorFeedback();
                if (getResetOtpCode().length === 6) {
                    if (resetAutoVerifyTimeout) clearTimeout(resetAutoVerifyTimeout);
                    resetAutoVerifyTimeout = setTimeout(() => {
                        if (!resetVerifyInProgress && resetConfirmForm && !resetConfirmForm.hidden) {
                            submitResetCodeVerification();
                        }
                    }, 220);
                }
            });
        });
    }

    if (resetOtpFeedbackClose) {
        resetOtpFeedbackClose.addEventListener('click', () => {
            clearResetOtpFeedback();
        });
    }

    if (loginTotpRecoveryVerifyMessageClose) {
        loginTotpRecoveryVerifyMessageClose.addEventListener('click', () => {
            if (loginTotpRecoveryVerifyMessage) {
                loginTotpRecoveryVerifyMessage.classList.remove('show');
                loginTotpRecoveryVerifyMessage.hidden = true;
            }
        });
    }

    const loginTotpCodeErrorClose = document.getElementById('loginTotpCodeErrorClose');
    if (loginTotpCodeErrorClose) {
        loginTotpCodeErrorClose.addEventListener('click', () => {
            clearLoginTotpErrorState();
        });
    }

    const loginRecoveryCodeErrorClose = document.getElementById('loginRecoveryCodeErrorClose');
    if (loginRecoveryCodeErrorClose) {
        loginRecoveryCodeErrorClose.addEventListener('click', () => {
            clearLoginRecoveryErrorState();
        });
    }

    if (resendResetCodeBtn) {
        resendResetCodeBtn.addEventListener('click', () => {
            if (!resetIdentifier || resendResetCodeBtn.disabled) return;
            clearResetAlert();
            clearResetOtpFeedback();
            resendResetCodeBtn.disabled = true;
            resendResetCodeBtn.classList.add('is-loading');
            fetch('/api/password/forgot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: resetIdentifier, email: resetIdentifier })
            })
                .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) {
                        setResetOtpFeedback(data.error || 'Failed to resend reset code.', 'error');
                        resendResetCodeBtn.classList.remove('is-loading');
                        resendResetCodeBtn.disabled = false;
                        return;
                    }
                    setResetOtpFeedback('Verification code has been resent to your email.', 'success');
                    clearForgotPasswordOtpInputs();
                    startResetResendCooldown(60);
                    resendResetCodeBtn.classList.remove('is-loading');
                })
                .catch(() => {
                    setResetOtpFeedback('Could not reach the server. Please try again.', 'error');
                    resendResetCodeBtn.classList.remove('is-loading');
                    resendResetCodeBtn.disabled = false;
                });
        });
    }

    if (resetConfirmForm) {
        resetConfirmForm.addEventListener('submit', function (e) {
            e.preventDefault();
            submitResetCodeVerification();
        });
    }

    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const newPassword = resetNewPasswordInput?.value || '';
            const confirmPassword = resetConfirmPasswordInput?.value || '';

            if (!navigator.onLine) {
                setResetAlert('You must be online to create or reset your password.');
                return;
            }

            const personalReset = {
                nickname: '',
                email: (resetIdentifier || (resetIdentifierInput?.value || '')).trim(),
                firstName: '',
                lastName: '',
            };
            if (
                window.DiariPasswordPolicy &&
                !window.DiariPasswordPolicy.isPasswordSubmitReady(newPassword, confirmPassword, personalReset)
            ) {
                setResetAlert('Please meet all password requirements.');
                return;
            }

            clearResetAlert();
            if (confirmResetBtn) {
                confirmResetBtn.disabled = true;
                confirmResetBtn.textContent = 'Updating...';
            }
            fetch('/api/password/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifier: resetIdentifier || (resetIdentifierInput?.value || '').trim(),
                    code: verifiedResetCode,
                    newPassword
                })
            })
                .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) {
                        const errorMessage = data.error || 'Failed to reset password.';
                        if (errorMessage === 'Please enter a password different from your previous one.') {
                            if (resetNewPasswordInput) {
                                resetNewPasswordInput.classList.add('error');
                                resetNewPasswordInput.classList.remove('success');
                            }
                            const newPasswordCustomError = document.getElementById('resetNewPassword-error');
                            if (newPasswordCustomError) {
                                DiariSecurity.hideInlineError(newPasswordCustomError);
                            }
                            showError(resetConfirmPasswordInput, errorMessage);
                        } else if (data.field === 'resetNewPassword' && resetNewPasswordInput) {
                            showError(resetNewPasswordInput, errorMessage);
                        } else {
                            setResetAlert(errorMessage);
                        }
                        return;
                    }
                    clearResetAlert();
                    closeResetModal();
                    requestAnimationFrame(function () {
                        showNotification('Password updated successfully. You can now sign in.', 'success', 5200);
                    });
                })
                .catch(() => setResetAlert('Could not reach the server. Please try again.'))
                .finally(() => {
                    if (confirmResetBtn) {
                        confirmResetBtn.disabled = false;
                        confirmResetBtn.textContent = 'Update Password';
                    }
                    if (resetPwLiveInst) resetPwLiveInst.refresh();
                });
        });
    }

    // Forgot password
    const forgotPassword = document.querySelector('.forgot-password');
    if (forgotPassword) {
        forgotPassword.addEventListener('click', function(e) {
            e.preventDefault();
            const username = document.getElementById('email').value.trim();
            openResetModal();
            if (username && resetIdentifierInput && isValidEmail(username)) {
                resetIdentifierInput.value = username;
            }
        });
    }
    
    // Notification function
    function showNotification(message, type = 'info', durationMs = 3000) {
        if (window.DiariToast && typeof window.DiariToast.show === 'function') {
            window.DiariToast.show(message, type, durationMs);
            return;
        }
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        
        notification.innerHTML = `
            <i class="bi bi-${icon}"></i>
            <span></span>
        `;
        if (window.DiariSecurity && window.DiariSecurity.setToastMessage) {
            window.DiariSecurity.setToastMessage(notification, message);
        } else {
            const span = notification.querySelector('span');
            if (span) span.textContent = String(message ?? '');
        }
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 10px;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-weight: 500;
            z-index: 13000;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            transform: translateX(100%);
            transition: transform 0.3s ease;
            max-width: 400px;
            word-wrap: break-word;
        `;
        
        if (window.DiariToastColors && window.DiariToastColors.bg && window.DiariToastColors.fg) {
            notification.style.backgroundColor = window.DiariToastColors.bg(type);
            notification.style.color = window.DiariToastColors.fg(type);
        } else if (type === 'success') {
            notification.style.backgroundColor = '#8da399';
            notification.style.color = '#ffffff';
        } else if (type === 'error') {
            notification.style.backgroundColor = '#e74c3c';
            notification.style.color = '#ffffff';
        } else if (type === 'warning') {
            notification.style.backgroundColor = '#d9822b';
            notification.style.color = '#ffffff';
        } else {
            notification.style.backgroundColor = '#7FA7BF';
            notification.style.color = '#ffffff';
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);
        
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, durationMs);
    }

    // Check auth status
    async function checkAuthStatus() {
        const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
        if (!user || !user.isLoggedIn) return;
        const currentPage = window.location.pathname.split('/').pop();
        if (!(currentPage === 'index.html' || currentPage === '' || currentPage === 'login.html')) {
            return;
        }
        /* Trust the live server, not the cached identity: after a redeploy or an
           expired session localStorage can still say "admin" while the session
           cookie is gone, which used to bounce the login page straight to a 403
           admin page. Only redirect once /api/user/me confirms a real session. */
        let serverUser = null;
        try {
            const res = await fetch('api/user/me?dc=' + Date.now(), {
                credentials: 'include',
                headers: { 'Accept': 'application/json' },
                cache: 'no-store'
            });
            if (res.ok) {
                const data = await res.json();
                serverUser = (data && data.user) || null;
            }
        } catch (e) {
            serverUser = null;
        }
        if (!serverUser) {
            try {
                localStorage.removeItem('diariCoreUser');
                if (window.DiariSecurity && typeof window.DiariSecurity.clearUserScopedLocalData === 'function') {
                    window.DiariSecurity.clearUserScopedLocalData();
                }
            } catch (e) {}
            return;
        }
        if (serverUser.isAdmin) {
            window.location.href = 'admin.html';
            return;
        }
        window.location.href = 'dashboard.html';
    }

    checkAuthStatus();

    const signUpFieldIds = [
        'nickname',
        'signUpEmail',
        'firstName',
        'lastName',
        'gender',
        'birthday',
        'signUpPassword',
        'confirmPassword'
    ];

    signUpFieldIds.forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (!field) return;
        field.addEventListener('blur', () => validateSignUpField(fieldId));
        field.addEventListener('input', () => validateSignUpField(fieldId));
        field.addEventListener('change', () => validateSignUpField(fieldId));
    });
    
    // Floating Label Animation
    function initFloatingLabels() {
        const inputWrappers = document.querySelectorAll('.input-wrapper');
        
        inputWrappers.forEach(wrapper => {
            const input = wrapper.querySelector('.form-input');
            
            if (input) {
                const syncHasContent = () => {
                    const v = (input.value ?? '').toString().trim();
                    if (v !== '') {
                        wrapper.classList.add('has-content');
                    } else {
                        wrapper.classList.remove('has-content');
                    }
                };
                // Check on load if input has value
                syncHasContent();
                
                // Add event listeners
                input.addEventListener('input', function() {
                    syncHasContent();
                });

                // Selects often only emit change, not input (fixes "Gender selected but looks blank")
                input.addEventListener('change', function() {
                    syncHasContent();
                });
                
                input.addEventListener('blur', function() {
                    syncHasContent();
                });
                
                input.addEventListener('focus', function() {
                    wrapper.classList.add('has-content');
                });
            }
        });
    }
    
    initFloatingLabels();

    function restoreAuthPhaseState() {
        try {
            const raw = sessionStorage.getItem('auth_modal_phase_state');
            if (!raw) return;
            const state = JSON.parse(raw);
            if (!state || !state.phase) return;

            if (state.phase === 'forgot_password') {
                openResetModal();
            } else if (state.phase === 'forgot_verify') {
                resetIdentifier = state.resetIdentifier || '';
                if (loginPasswordResetStep) loginPasswordResetStep.hidden = false;
                if (signinMainFlow) signinMainFlow.hidden = true;
                if (signinMainFormHeader) signinMainFormHeader.hidden = true;
                if (resetRequestForm) resetRequestForm.hidden = true;
                if (resetPasswordForm) resetPasswordForm.hidden = true;
                if (resetConfirmForm) showResetStep(resetConfirmForm);
                if (resetTitle) resetTitle.textContent = 'Verification';
                if (resetSubtitle) resetSubtitle.textContent = 'Thank you for verifying. Kindly check your email for the code.';
                startResetResendCooldown(60);
            } else if (state.phase === 'reset_password') {
                resetIdentifier = state.resetIdentifier || '';
                verifiedResetCode = state.verifiedResetCode || '';
                if (loginPasswordResetStep) loginPasswordResetStep.hidden = false;
                if (signinMainFlow) signinMainFlow.hidden = true;
                if (signinMainFormHeader) signinMainFormHeader.hidden = true;
                if (resetRequestForm) resetRequestForm.hidden = true;
                if (resetConfirmForm) resetConfirmForm.hidden = true;
                if (resetPasswordForm) showResetStep(resetPasswordForm);
                if (resetTitle) resetTitle.textContent = 'Reset Password';
                if (resetSubtitle) resetSubtitle.textContent = 'Please choose a new password that is different from your old one.';
                initResetPasswordLive();
            } else if (state.phase === '2fa_verify') {
                if (state.pendingTwoFactorToken) {
                    showLoginTotpStep(state.pendingTwoFactorToken);
                }
            }
        } catch (e) {
            console.error('Error restoring auth phase state:', e);
        } finally {
            document.documentElement.classList.remove('auth-phase-restoring');
        }
    }

    if (initialMode === 'signup' && signupSection && signupWelcome) {
        // Ensure the correct view when coming back from verification page
        switchToSignUp();
    } else {
        restoreAuthPhaseState();
        checkExistingLoginLockout();
    }
});
