//! Voice (VOICE.md): dictation with the macOS Speech framework, on-device,
//! and read-aloud with AVSpeechSynthesizer.
//!
//! The page never touches the microphone. It asks the host to start a
//! recognition; the host opens the microphone (AVAudioEngine) only for that
//! recognition, streams partial and final text back to the calling webview as
//! `voice-event` events, and closes it when the recognition stops. No audio is
//! written anywhere. Recognition is on-device unless the person allowed
//! Apple's server for a language their Mac cannot recognize locally.
//!
//! Every Objective-C object lives on the main thread (`ACTIVE` and `SYNTH`
//! are thread-locals there); commands hop to it with `run_on_main_thread`.
//! The pure layer (permission states, language lists, levels, rates) is
//! platform-independent and unit-tested.
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Webview};

/// An authorization the system holds for this app, for the microphone or for
/// speech recognition.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    Granted,
    Denied,
    Restricted,
    NotDetermined,
    Unsupported,
}

impl Permission {
    /// `SFSpeechRecognizerAuthorizationStatus`: not determined 0, denied 1,
    /// restricted 2, authorized 3.
    pub fn from_speech(raw: isize) -> Self {
        match raw {
            0 => Self::NotDetermined,
            1 => Self::Denied,
            2 => Self::Restricted,
            3 => Self::Granted,
            _ => Self::Unsupported,
        }
    }
    /// `AVAuthorizationStatus` orders its values differently: not determined
    /// 0, restricted 1, denied 2, authorized 3.
    pub fn from_capture(raw: isize) -> Self {
        match raw {
            0 => Self::NotDetermined,
            1 => Self::Restricted,
            2 => Self::Denied,
            3 => Self::Granted,
            _ => Self::Unsupported,
        }
    }
}

/// What the Settings page and the dictation pill show before a recognition.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The recognizer for the asked language exists and is ready.
    pub available: bool,
    /// That language is recognized on this Mac, without a server.
    pub on_device: bool,
    pub microphone: Permission,
    pub speech: Permission,
    /// Why it is not available, as a sentence; empty when it is.
    pub reason: String,
    /// The system's first preferred language (BCP 47), what "Automatic" uses.
    pub language: String,
}

impl Status {
    /// Where voice does not exist (the desktop app off macOS).
    #[cfg(any(test, not(target_os = "macos")))]
    pub fn unsupported(reason: &str) -> Self {
        Self {
            available: false,
            on_device: false,
            microphone: Permission::Unsupported,
            speech: Permission::Unsupported,
            reason: reason.into(),
            language: String::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Language {
    /// A BCP 47 tag: `en-US`, `fr-FR`, `zh-Hans-CN`.
    pub code: String,
    /// Its name in the person's language: "French (France)".
    pub name: String,
    pub on_device: bool,
}

/// A locale identifier as the Speech framework or the page names it
/// (`en_US`, `fr-FR`), as a BCP 47 tag; None for anything that is not one.
/// Only letters and digits in short subtags pass, so a value from the page
/// can never be more than a locale name.
pub fn bcp47(identifier: &str) -> Option<String> {
    let parts: Vec<&str> = identifier.split(['_', '-']).collect();
    let first = parts.first()?;
    if !(2..=3).contains(&first.len()) || !first.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    if parts.len() > 4
        || parts[1..]
            .iter()
            .any(|p| p.is_empty() || p.len() > 8 || !p.bytes().all(|b| b.is_ascii_alphanumeric()))
    {
        return None;
    }
    Some(
        parts
            .iter()
            .enumerate()
            .map(|(i, p)| match (i, p.len()) {
                (0, _) => p.to_ascii_lowercase(),
                (_, 2) => p.to_ascii_uppercase(),
                (_, 4) => {
                    let mut s = p[..1].to_ascii_uppercase();
                    s.push_str(&p[1..].to_ascii_lowercase());
                    s
                }
                _ => p.to_string(),
            })
            .collect::<Vec<_>>()
            .join("-"),
    )
}

/// The languages the recognizer offers, as (identifier, name, on-device):
/// valid tags only, each once, the system's language first and the rest by
/// name.
pub fn languages(
    reported: impl IntoIterator<Item = (String, String, bool)>,
    system: &str,
) -> Vec<Language> {
    let mut out: Vec<Language> = Vec::new();
    for (identifier, name, on_device) in reported {
        let Some(code) = bcp47(&identifier) else {
            continue;
        };
        if out.iter().any(|l| l.code == code) {
            continue;
        }
        let name = if name.trim().is_empty() {
            code.clone()
        } else {
            name.trim().to_string()
        };
        out.push(Language {
            code,
            name,
            on_device,
        });
    }
    let system = bcp47(system).unwrap_or_default();
    out.sort_by(|a, b| {
        (a.code != system)
            .cmp(&(b.code != system))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// How a recognition starts, as the page asks for it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartOptions {
    /// A BCP 47 tag, or empty for the system's language.
    #[serde(default)]
    pub language: String,
    /// Let the recognizer punctuate (macOS 13 and later).
    #[serde(default)]
    pub punctuation: bool,
    /// Use Apple's server when this Mac cannot recognize the language itself.
    #[serde(default)]
    pub allow_server: bool,
}

impl StartOptions {
    pub fn validate(self) -> Result<Self, String> {
        if !self.language.is_empty() && bcp47(&self.language).is_none() {
            return Err("unknown-language: That language is not one the Mac can recognize.".into());
        }
        Ok(self)
    }
}

/// What a recognition reports to the page that started it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    /// The text of one stretch of speech so far; `final` once it is settled.
    Result {
        session: u64,
        segment: u32,
        text: String,
        #[serde(rename = "final")]
        is_final: bool,
    },
    /// The microphone's level, 0 to 1, a few times a second.
    Level { session: u64, level: f32 },
    Error {
        session: u64,
        code: String,
        message: String,
    },
    /// The recognition is over and the microphone is closed.
    End { session: u64 },
}

pub const EVENT: &str = "voice-event";

/// The loudness of a buffer of samples on a 0–1 scale: its RMS in decibels,
/// from -55 dB (silence) to -5 dB (shouting into the microphone).
pub fn level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mean = samples
        .iter()
        .filter(|s| s.is_finite())
        .map(|s| s * s)
        .sum::<f32>()
        / samples.len() as f32;
    let db = 10.0 * mean.max(1e-12).log10();
    ((db + 55.0) / 50.0).clamp(0.0, 1.0)
}

/// System Settings' privacy pane for one permission. Only these two URLs can
/// be opened: the page names a pane, never a URL.
/// What to say when macOS's Dictation is off: its recognizer will not run without it.
const DICTATION_OFF: &str = "Voice uses macOS Dictation, which is turned off. Turn it on in System Settings → Keyboard → Dictation (macOS downloads its on-device model the first time), then try again.";

pub fn settings_url(pane: &str) -> Result<&'static str, String> {
    match pane {
        "microphone" => {
            Ok("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        }
        "speech" => {
            Ok("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition")
        }
        // Keyboard → Dictation: macOS's recognizer refuses to run while Dictation is off.
        "keyboard" => Ok("x-apple.systempreferences:com.apple.Keyboard-Settings.extension"),
        _ => Err("unknown settings pane".into()),
    }
}

/// What to read aloud and how.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeakOptions {
    pub text: String,
    /// A voice identifier from `speech_voices`, or empty for the default.
    #[serde(default)]
    pub voice: String,
    /// 0.5 (slow) to 2 (fast); 1 is the system's normal pace.
    #[serde(default = "normal_rate")]
    pub rate: f32,
}
fn normal_rate() -> f32 {
    1.0
}

pub const SPEAK_LIMIT: usize = 20_000;

impl SpeakOptions {
    pub fn validate(mut self) -> Result<Self, String> {
        if self.text.trim().is_empty() {
            return Err("Nothing to read aloud.".into());
        }
        if self.text.chars().count() > SPEAK_LIMIT {
            self.text = self.text.chars().take(SPEAK_LIMIT).collect();
        }
        if self.voice.len() > 256 || self.voice.chars().any(char::is_control) {
            return Err("Unknown voice.".into());
        }
        if !self.rate.is_finite() {
            self.rate = 1.0;
        }
        Ok(self)
    }
}

/// AVSpeechUtterance's rate for a pace multiplier: the system's default rate
/// times it, within the rates the synthesizer accepts.
pub fn utterance_rate(multiplier: f32, default: f32, min: f32, max: f32) -> f32 {
    let multiplier = if multiplier.is_finite() {
        multiplier.clamp(0.5, 2.0)
    } else {
        1.0
    };
    (default * multiplier).clamp(min, max)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub language: String,
}

/// Runs `work` on the main thread, where every Speech and AVFoundation object
/// of this module lives, and waits for its answer.
async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    wait: Duration,
    work: impl FnOnce(std::sync::mpsc::Sender<Result<T, String>>) + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = std::sync::mpsc::channel::<Result<T, String>>();
    app.run_on_main_thread(move || work(send))
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv_timeout(wait)
            .map_err(|_| "The system did not answer in time.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
const QUICK: Duration = Duration::from_secs(20);
/// A permission prompt waits for the person.
const PROMPT: Duration = Duration::from_secs(600);

#[tauri::command]
pub async fn voice_status(app: AppHandle, language: String) -> Result<Status, String> {
    let language = if language.is_empty() {
        String::new()
    } else {
        bcp47(&language).ok_or("unknown language")?
    };
    on_main(&app, QUICK, move |send| {
        let _ = send.send(Ok(native::status(&language)));
    })
    .await
}

#[tauri::command]
pub async fn voice_request_permission(app: AppHandle, language: String) -> Result<Status, String> {
    let language = if language.is_empty() {
        String::new()
    } else {
        bcp47(&language).ok_or("unknown language")?
    };
    on_main(&app, PROMPT, move |send| {
        native::request_permission(language, send)
    })
    .await
}

#[tauri::command]
pub async fn voice_languages(app: AppHandle) -> Result<Vec<Language>, String> {
    on_main(&app, QUICK, |send| {
        let _ = send.send(Ok(native::languages()));
    })
    .await
}

#[tauri::command]
pub fn voice_open_settings(app: AppHandle, pane: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = settings_url(&pane)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Starts a recognition for the calling webview; its events go to that
/// webview only. A recognition already running (another window's) is
/// cancelled first: one microphone, one dictation.
#[tauri::command]
pub async fn voice_start(
    app: AppHandle,
    webview: Webview,
    options: StartOptions,
) -> Result<u64, String> {
    let options = options.validate()?;
    let label = webview.label().to_string();
    let handle = app.clone();
    on_main(&app, QUICK, move |send| {
        let _ = send.send(native::start(handle, label, options));
    })
    .await
}

/// Stops listening: the recognizer settles what it heard and ends.
#[tauri::command]
pub async fn voice_stop(app: AppHandle, session: u64) -> Result<(), String> {
    on_main(&app, QUICK, move |send| {
        native::stop(session);
        let _ = send.send(Ok(()));
    })
    .await
}

/// Stops listening and drops what was heard.
#[tauri::command]
pub async fn voice_cancel(app: AppHandle, session: u64) -> Result<(), String> {
    let handle = app.clone();
    on_main(&app, QUICK, move |send| {
        native::cancel(&handle, session);
        let _ = send.send(Ok(()));
    })
    .await
}

#[tauri::command]
pub async fn speech_voices(app: AppHandle) -> Result<Vec<Voice>, String> {
    on_main(&app, QUICK, |send| {
        let _ = send.send(Ok(native::voices()));
    })
    .await
}

#[tauri::command]
pub async fn speech_speak(app: AppHandle, options: SpeakOptions) -> Result<(), String> {
    let options = options.validate()?;
    on_main(&app, QUICK, move |send| {
        let _ = send.send(native::speak(&options));
    })
    .await
}

#[tauri::command]
pub async fn speech_stop(app: AppHandle) -> Result<(), String> {
    on_main(&app, QUICK, |send| {
        native::stop_speaking();
        let _ = send.send(Ok(()));
    })
    .await
}

#[tauri::command]
pub async fn speech_speaking(app: AppHandle) -> Result<bool, String> {
    on_main(&app, QUICK, |send| {
        let _ = send.send(Ok(native::speaking()));
    })
    .await
}

#[cfg(target_os = "macos")]
mod native {
    use super::{Event, Language, Permission, SpeakOptions, StartOptions, Status, Voice};
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObjectProtocol};
    use objc2::{AnyThread, sel};
    use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};
    use objc2_avf_audio::{
        AVAudioEngine, AVAudioPCMBuffer, AVAudioTime, AVSpeechBoundary, AVSpeechSynthesisVoice,
        AVSpeechSynthesizer, AVSpeechUtterance, AVSpeechUtteranceDefaultSpeechRate,
        AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceMinimumSpeechRate,
    };
    use objc2_foundation::{NSError, NSLocale, NSString};
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
        SFSpeechRecognizer,
    };
    use std::cell::RefCell;
    use std::ptr::NonNull;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::{AppHandle, Emitter, EventTarget};

    struct Active {
        id: u64,
        /// The webview that started it, which alone hears its events.
        label: String,
        engine: Retained<AVAudioEngine>,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        /// Kept alive for the task's lifetime.
        _recognizer: Retained<SFSpeechRecognizer>,
        /// Set when the page cancelled: the error the cancelled task reports is not news.
        cancelled: Arc<AtomicBool>,
        listening: bool,
    }

    thread_local! {
        static ACTIVE: RefCell<Option<Active>> = const { RefCell::new(None) };
        static SYNTH: RefCell<Option<Retained<AVSpeechSynthesizer>>> = const { RefCell::new(None) };
        static LANGUAGES: RefCell<Option<Vec<Language>>> = const { RefCell::new(None) };
    }
    static SESSIONS: AtomicU64 = AtomicU64::new(0);

    fn emit(app: &AppHandle, label: &str, event: Event) {
        let _ = app.emit_to(EventTarget::webview(label), super::EVENT, event);
    }

    fn system_language() -> String {
        NSLocale::preferredLanguages()
            .iter()
            .next()
            .and_then(|l| super::bcp47(&l.to_string()))
            .unwrap_or_default()
    }

    fn recognizer(language: &str) -> Option<Retained<SFSpeechRecognizer>> {
        unsafe {
            if language.is_empty() {
                SFSpeechRecognizer::init(SFSpeechRecognizer::alloc())
            } else {
                let locale = NSLocale::localeWithLocaleIdentifier(&NSString::from_str(language));
                SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
            }
        }
    }

    fn microphone() -> Permission {
        match unsafe { AVMediaTypeAudio } {
            Some(audio) => Permission::from_capture(
                unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) }.0,
            ),
            None => Permission::Unsupported,
        }
    }

    pub fn status(language: &str) -> Status {
        let speech =
            Permission::from_speech(unsafe { SFSpeechRecognizer::authorizationStatus() }.0);
        let microphone = microphone();
        let system = system_language();
        let Some(recognizer) = recognizer(language) else {
            return Status {
                available: false,
                on_device: false,
                microphone,
                speech,
                reason: "This Mac does not recognize that language.".into(),
                language: system,
            };
        };
        let available = unsafe { recognizer.isAvailable() };
        Status {
            available,
            on_device: unsafe { recognizer.supportsOnDeviceRecognition() },
            microphone,
            speech,
            reason: if available {
                String::new()
            } else {
                "Speech recognition is not available right now.".into()
            },
            language: system,
        }
    }

    /// Asks for speech recognition, then for the microphone, each only if
    /// the person was never asked; answers with the status after both.
    pub fn request_permission(
        language: String,
        send: std::sync::mpsc::Sender<Result<Status, String>>,
    ) {
        let after_speech = RcBlock::new(
            move |_status: objc2_speech::SFSpeechRecognizerAuthorizationStatus| {
                let send = send.clone();
                let language = language.clone();
                let done = RcBlock::new(move |_granted: Bool| {
                    let send = send.clone();
                    let language = language.clone();
                    // The status reads the recognizer, which lives on the main thread.
                    dispatch_main(move || {
                        let _ = send.send(Ok(status(&language)));
                    });
                });
                match unsafe { AVMediaTypeAudio } {
                    Some(audio) => unsafe {
                        AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &done)
                    },
                    None => done.call((Bool::NO,)),
                }
            },
        );
        unsafe { SFSpeechRecognizer::requestAuthorization(&after_speech) };
    }

    /// A closure to the main queue (the permission handlers answer on any thread).
    fn dispatch_main(work: impl FnOnce() + Send + 'static) {
        use objc2_foundation::NSOperationQueue;
        let work = std::cell::Cell::new(Some(work));
        let block = RcBlock::new(move || {
            if let Some(work) = work.take() {
                work();
            }
        });
        unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&block) };
    }

    /// Asking each language whether it is on-device takes a quarter of a
    /// second on the main thread: once per launch is enough.
    pub fn languages() -> Vec<Language> {
        if let Some(known) = LANGUAGES.with(|l| l.borrow().clone()) {
            return known;
        }
        let list = read_languages();
        LANGUAGES.with(|l| *l.borrow_mut() = Some(list.clone()));
        list
    }

    fn read_languages() -> Vec<Language> {
        let current = NSLocale::currentLocale();
        let reported: Vec<(String, String, bool)> =
            unsafe { SFSpeechRecognizer::supportedLocales() }
                .iter()
                .map(|locale| {
                    let identifier = locale.localeIdentifier();
                    let name = current
                        .localizedStringForLocaleIdentifier(&identifier)
                        .to_string();
                    let on_device = unsafe {
                        SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
                            .map(|r| r.supportsOnDeviceRecognition())
                            .unwrap_or(false)
                    };
                    (identifier.to_string(), name, on_device)
                })
                .collect();
        super::languages(reported, &system_language())
    }

    fn now_millis() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn release(active: &mut Active) {
        if active.listening {
            active.listening = false;
            unsafe {
                active.engine.inputNode().removeTapOnBus(0);
                active.engine.stop();
                active.request.endAudio();
            }
        }
    }

    pub fn start(app: AppHandle, label: String, options: StartOptions) -> Result<u64, String> {
        let speech =
            Permission::from_speech(unsafe { SFSpeechRecognizer::authorizationStatus() }.0);
        if speech != Permission::Granted {
            return Err(
                "speech-permission: Allow speech recognition for Lazybox in Settings → Voice."
                    .into(),
            );
        }
        if microphone() != Permission::Granted {
            return Err(
                "microphone-permission: Allow the microphone for Lazybox in Settings → Voice."
                    .into(),
            );
        }
        let language = super::bcp47(&options.language).unwrap_or_default();
        let recognizer = recognizer(&language)
            .ok_or("unknown-language: This Mac does not recognize that language.")?;
        if !unsafe { recognizer.isAvailable() } {
            return Err("unavailable: Speech recognition is not available right now. Try again in a moment.".into());
        }
        let on_device = unsafe { recognizer.supportsOnDeviceRecognition() };
        if !on_device && !options.allow_server {
            return Err("on-device-unavailable: This Mac cannot recognize that language on-device. Add it in System Settings → Keyboard → Dictation, or allow Apple's server in Settings → Voice.".into());
        }
        // One microphone, one dictation: a recognition another window left running ends here.
        if let Some(previous) = ACTIVE.with(|a| a.borrow().as_ref().map(|a| a.id)) {
            cancel(&app, previous);
        }
        let id = SESSIONS.fetch_add(1, Ordering::Relaxed) + 1;
        let request = unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
        unsafe {
            request.setShouldReportPartialResults(true);
            request.setRequiresOnDeviceRecognition(on_device);
            if options.punctuation && request.respondsToSelector(sel!(setAddsPunctuation:)) {
                request.setAddsPunctuation(true);
            }
        }
        let engine = unsafe { AVAudioEngine::new() };
        let input = unsafe { engine.inputNode() };
        let format = unsafe { input.outputFormatForBus(0) };
        if unsafe { format.sampleRate() } <= 0.0 || unsafe { format.channelCount() } == 0 {
            return Err("no-microphone: No microphone is connected.".into());
        }
        // The tap runs on an audio thread: it feeds the recognizer and, a
        // few times a second, reports the level.
        let tap_request = request.clone();
        let (tap_app, tap_label) = (app.clone(), label.clone());
        let last = Arc::new(AtomicU64::new(0));
        let tap = RcBlock::new(
            move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                let buffer = unsafe { buffer.as_ref() };
                unsafe { tap_request.appendAudioPCMBuffer(buffer) };
                let now = now_millis();
                if now.saturating_sub(last.load(Ordering::Relaxed)) < 70 {
                    return;
                }
                last.store(now, Ordering::Relaxed);
                let level = unsafe {
                    let channels = buffer.floatChannelData();
                    let frames = buffer.frameLength() as usize;
                    if channels.is_null() || frames == 0 {
                        0.0
                    } else {
                        super::level(std::slice::from_raw_parts((*channels).as_ptr(), frames))
                    }
                };
                emit(&tap_app, &tap_label, Event::Level { session: id, level });
            },
        );
        unsafe {
            input.installTapOnBus_bufferSize_format_block(
                0,
                1024,
                Some(&format),
                &*tap as *const _ as *mut _,
            );
            engine.prepare();
        }
        if let Err(error) = unsafe { engine.startAndReturnError() } {
            unsafe { input.removeTapOnBus(0) };
            return Err(format!(
                "microphone: The microphone could not start: {}",
                error.localizedDescription()
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let (result_app, result_label, result_cancelled) =
            (app.clone(), label.clone(), cancelled.clone());
        let handler = RcBlock::new(
            move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
                let mut done = false;
                if let Some(result) = unsafe { result.as_ref() } {
                    let text = unsafe { result.bestTranscription().formattedString() }.to_string();
                    let is_final = unsafe { result.isFinal() };
                    emit(
                        &result_app,
                        &result_label,
                        Event::Result {
                            session: id,
                            segment: 0,
                            text,
                            is_final,
                        },
                    );
                    done = is_final;
                }
                if let Some(error) = unsafe { error.as_ref() } {
                    done = true;
                    if !result_cancelled.load(Ordering::Relaxed) {
                        // 1110: nothing was said; 203/216: the task was cancelled or ended early.
                        let (code, message) = match error.code() {
                            1110 => ("no-speech", "Nothing was heard.".to_string()),
                            // kAFAssistantErrorDomain 1700: "Siri and Dictation are disabled".
                            1700 => ("dictation-off", super::DICTATION_OFF.to_string()),
                            203 | 216 | 301 => ("ended", String::new()),
                            _ => ("recognition", error.localizedDescription().to_string()),
                        };
                        if !message.is_empty() {
                            emit(
                                &result_app,
                                &result_label,
                                Event::Error {
                                    session: id,
                                    code: code.into(),
                                    message,
                                },
                            );
                        }
                    }
                }
                if done {
                    finish(&result_app, &result_label, id);
                }
            },
        );
        let task =
            unsafe { recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler) };
        ACTIVE.with(|a| {
            *a.borrow_mut() = Some(Active {
                id,
                label,
                engine,
                request,
                task,
                _recognizer: recognizer,
                cancelled,
                listening: true,
            })
        });
        Ok(id)
    }

    /// The recognition ended (settled, failed or cancelled): the microphone
    /// closes and the page hears that it is over.
    fn finish(app: &AppHandle, label: &str, id: u64) {
        // Taken out before any call into the frameworks: one may call the
        // result handler, which comes back here, while the slot is borrowed.
        if let Some(mut active) = take(id) {
            release(&mut active);
            emit(app, label, Event::End { session: id });
        }
    }

    fn take(id: u64) -> Option<Active> {
        ACTIVE.with(|a| {
            let mut slot = a.borrow_mut();
            if slot.as_ref().is_some_and(|a| a.id == id) {
                slot.take()
            } else {
                None
            }
        })
    }

    /// Closes the microphone; the recognizer settles what it heard, and its
    /// final result ends the recognition (`finish`).
    pub fn stop(id: u64) {
        if let Some(mut active) = take(id) {
            release(&mut active);
            ACTIVE.with(|a| {
                let mut slot = a.borrow_mut();
                if slot.is_none() {
                    *slot = Some(active);
                }
            });
        }
    }

    pub fn cancel(app: &AppHandle, id: u64) {
        if let Some(mut active) = take(id) {
            active.cancelled.store(true, Ordering::Relaxed);
            release(&mut active);
            unsafe { active.task.cancel() };
            emit(app, &active.label, Event::End { session: id });
        }
    }

    fn synthesizer() -> Retained<AVSpeechSynthesizer> {
        SYNTH.with(|s| {
            s.borrow_mut()
                .get_or_insert_with(|| unsafe { AVSpeechSynthesizer::new() })
                .clone()
        })
    }

    pub fn voices() -> Vec<Voice> {
        let mut voices: Vec<Voice> = unsafe { AVSpeechSynthesisVoice::speechVoices() }
            .iter()
            .map(|v| unsafe {
                Voice {
                    id: v.identifier().to_string(),
                    name: v.name().to_string(),
                    language: super::bcp47(&v.language().to_string()).unwrap_or_default(),
                }
            })
            .filter(|v| !v.language.is_empty())
            .collect();
        voices.sort_by(|a, b| {
            a.language
                .cmp(&b.language)
                .then_with(|| a.name.cmp(&b.name))
        });
        voices
    }

    pub fn speak(options: &SpeakOptions) -> Result<(), String> {
        let synth = synthesizer();
        unsafe {
            synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
            let utterance =
                AVSpeechUtterance::speechUtteranceWithString(&NSString::from_str(&options.text));
            if !options.voice.is_empty() {
                let voice = AVSpeechSynthesisVoice::voiceWithIdentifier(&NSString::from_str(
                    &options.voice,
                ))
                .ok_or("That voice is not installed on this Mac.")?;
                utterance.setVoice(Some(&voice));
            }
            utterance.setRate(super::utterance_rate(
                options.rate,
                AVSpeechUtteranceDefaultSpeechRate,
                AVSpeechUtteranceMinimumSpeechRate,
                AVSpeechUtteranceMaximumSpeechRate,
            ));
            synth.speakUtterance(&utterance);
        }
        Ok(())
    }

    pub fn stop_speaking() {
        SYNTH.with(|s| {
            if let Some(synth) = s.borrow().as_ref() {
                unsafe { synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate) };
            }
        });
    }

    pub fn speaking() -> bool {
        SYNTH.with(|s| {
            s.borrow()
                .as_ref()
                .is_some_and(|synth| unsafe { synth.isSpeaking() })
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::{Language, SpeakOptions, StartOptions, Status, Voice};
    use tauri::AppHandle;
    const UNSUPPORTED: &str =
        "Voice in the desktop app needs macOS. Use the browser client for Web Speech.";
    pub fn status(_language: &str) -> Status {
        Status::unsupported(UNSUPPORTED)
    }
    pub fn request_permission(
        _language: String,
        send: std::sync::mpsc::Sender<Result<Status, String>>,
    ) {
        let _ = send.send(Ok(Status::unsupported(UNSUPPORTED)));
    }
    pub fn languages() -> Vec<Language> {
        Vec::new()
    }
    pub fn start(_app: AppHandle, _label: String, _options: StartOptions) -> Result<u64, String> {
        Err(format!("unsupported: {UNSUPPORTED}"))
    }
    pub fn stop(_id: u64) {}
    pub fn cancel(_app: &AppHandle, _id: u64) {}
    pub fn voices() -> Vec<Voice> {
        Vec::new()
    }
    pub fn speak(_options: &SpeakOptions) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn stop_speaking() {}
    pub fn speaking() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_states_follow_each_framework_numbering() {
        // SFSpeechRecognizerAuthorizationStatus
        assert_eq!(Permission::from_speech(0), Permission::NotDetermined);
        assert_eq!(Permission::from_speech(1), Permission::Denied);
        assert_eq!(Permission::from_speech(2), Permission::Restricted);
        assert_eq!(Permission::from_speech(3), Permission::Granted);
        // AVAuthorizationStatus swaps denied and restricted.
        assert_eq!(Permission::from_capture(0), Permission::NotDetermined);
        assert_eq!(Permission::from_capture(1), Permission::Restricted);
        assert_eq!(Permission::from_capture(2), Permission::Denied);
        assert_eq!(Permission::from_capture(3), Permission::Granted);
        for raw in [-1, 4, 99] {
            assert_eq!(Permission::from_speech(raw), Permission::Unsupported);
            assert_eq!(Permission::from_capture(raw), Permission::Unsupported);
        }
        assert_eq!(
            serde_json::to_value(Permission::NotDetermined).unwrap(),
            "not-determined"
        );
        let status = serde_json::to_value(Status::unsupported("No")).unwrap();
        assert_eq!(status["onDevice"], false);
        assert_eq!(status["microphone"], "unsupported");
    }

    #[test]
    fn locale_identifiers_become_bcp47_tags_and_nothing_else_passes() {
        assert_eq!(bcp47("en_US").as_deref(), Some("en-US"));
        assert_eq!(bcp47("fr-fr").as_deref(), Some("fr-FR"));
        assert_eq!(bcp47("zh_hans_CN").as_deref(), Some("zh-Hans-CN"));
        assert_eq!(bcp47("yue_CN").as_deref(), Some("yue-CN"));
        assert_eq!(bcp47("es-419").as_deref(), Some("es-419"));
        assert_eq!(bcp47("fr").as_deref(), Some("fr"));
        for invalid in [
            "",
            "e",
            "english",
            "en US",
            "en-",
            "en--US",
            "../en",
            "en-US;rm",
            "12-US",
            "en-a-b-c-d",
        ] {
            assert_eq!(bcp47(invalid), None, "{invalid}");
        }
        assert!(
            StartOptions {
                language: "fr_FR".into(),
                punctuation: true,
                allow_server: false
            }
            .validate()
            .is_ok()
        );
        assert!(
            StartOptions {
                language: String::new(),
                punctuation: false,
                allow_server: false
            }
            .validate()
            .is_ok()
        );
        let refused = StartOptions {
            language: "fr FR".into(),
            punctuation: false,
            allow_server: false,
        }
        .validate();
        assert!(refused.unwrap_err().starts_with("unknown-language:"));
        let options: Result<StartOptions, _> =
            serde_json::from_str(r#"{"language":"en-US","record":true}"#);
        assert!(options.is_err(), "unknown fields are refused");
    }

    #[test]
    fn language_list_is_valid_unique_system_first_then_by_name() {
        let reported = [
            ("fr_FR", "French (France)", true),
            ("en_US", "English (United States)", true),
            ("de_DE", "German (Germany)", false),
            ("en-US", "English (US) again", true),
            ("bad tag", "Nonsense", true),
            ("ja_JP", "", false),
            ("en_GB", "English (United Kingdom)", true),
        ]
        .map(|(a, b, c)| (a.to_string(), b.to_string(), c));
        let list = languages(reported, "fr-FR");
        let codes: Vec<&str> = list.iter().map(|l| l.code.as_str()).collect();
        assert_eq!(codes, ["fr-FR", "en-GB", "en-US", "de-DE", "ja-JP"]);
        assert_eq!(list[0].code, "fr-FR");
        // The rest by name; a missing name is its code.
        let names: Vec<&str> = list[1..].iter().map(|l| l.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "English (United Kingdom)",
                "English (United States)",
                "German (Germany)",
                "ja-JP"
            ]
        );
        assert!(
            !list
                .iter()
                .any(|l| l.name == "Nonsense" || l.name == "English (US) again")
        );
        assert!(!list.iter().find(|l| l.code == "de-DE").unwrap().on_device);
        let json = serde_json::to_value(&list[0]).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "fr-FR", "name": "French (France)", "onDevice": true })
        );
        // An unrecognizable system language leaves the order by name.
        assert_eq!(languages(Vec::new(), "??"), Vec::new());
    }

    #[test]
    fn events_serialize_as_the_page_reads_them() {
        let result = Event::Result {
            session: 3,
            segment: 0,
            text: "Bonjour".into(),
            is_final: true,
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({ "kind": "result", "session": 3, "segment": 0, "text": "Bonjour", "final": true })
        );
        assert_eq!(
            serde_json::to_value(Event::End { session: 3 }).unwrap(),
            serde_json::json!({ "kind": "end", "session": 3 })
        );
        let error = Event::Error {
            session: 1,
            code: "no-speech".into(),
            message: "Nothing was heard.".into(),
        };
        assert_eq!(serde_json::to_value(error).unwrap()["code"], "no-speech");
    }

    #[test]
    fn level_is_a_decibel_scale_from_silence_to_loud() {
        assert_eq!(level(&[]), 0.0);
        assert_eq!(level(&[0.0; 512]), 0.0);
        let quiet = level(&[0.003; 512]);
        let speech = level(&[0.05; 512]);
        let loud = level(&[0.9; 512]);
        assert!(quiet < 0.2, "{quiet}");
        assert!(speech > quiet && speech < loud, "{speech}");
        assert_eq!(level(&[1.0; 16]), 1.0);
        assert_eq!(level(&[f32::NAN, 0.0]), 0.0);
    }

    #[test]
    fn only_the_two_privacy_panes_open() {
        assert!(
            settings_url("microphone")
                .unwrap()
                .ends_with("Privacy_Microphone")
        );
        assert!(
            settings_url("speech")
                .unwrap()
                .ends_with("Privacy_SpeechRecognition")
        );
        assert!(settings_url("https://example.com").is_err());
        assert!(settings_url("").is_err());
    }

    /// Reads the real Speech and AVFoundation frameworks (no prompt, no
    /// microphone): run by hand on a Mac with `cargo test -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "reads this Mac's speech frameworks"]
    fn the_real_frameworks_answer_on_this_mac() {
        let list = native::languages();
        assert!(
            !list.is_empty(),
            "macOS offers speech recognition languages"
        );
        assert!(
            list.iter()
                .all(|l| bcp47(&l.code).as_deref() == Some(l.code.as_str()))
        );
        let status = native::status("");
        assert_ne!(status.speech, Permission::Unsupported);
        assert_ne!(status.microphone, Permission::Unsupported);
        assert!(!native::voices().is_empty(), "macOS has voices");
        eprintln!(
            "{} languages; system {}; on-device {}; {:?}",
            list.len(),
            status.language,
            status.on_device,
            status
        );
    }

    #[test]
    fn read_aloud_options_are_bounded() {
        let options: SpeakOptions = serde_json::from_str(r#"{"text":"Hello"}"#).unwrap();
        assert_eq!(options.rate, 1.0);
        assert!(
            SpeakOptions {
                text: "  ".into(),
                voice: String::new(),
                rate: 1.0
            }
            .validate()
            .is_err()
        );
        let long = SpeakOptions {
            text: "a".repeat(SPEAK_LIMIT + 10),
            voice: String::new(),
            rate: f32::NAN,
        }
        .validate()
        .unwrap();
        assert_eq!(long.text.len(), SPEAK_LIMIT);
        assert_eq!(long.rate, 1.0);
        assert!(
            SpeakOptions {
                text: "Hi".into(),
                voice: "bad\nvoice".into(),
                rate: 1.0
            }
            .validate()
            .is_err()
        );
        // AVSpeechUtterance: default 0.5, range 0–1.
        assert_eq!(utterance_rate(1.0, 0.5, 0.0, 1.0), 0.5);
        assert_eq!(utterance_rate(2.0, 0.5, 0.0, 1.0), 1.0);
        assert_eq!(utterance_rate(9.0, 0.5, 0.0, 1.0), 1.0);
        assert_eq!(utterance_rate(0.1, 0.5, 0.0, 1.0), 0.25);
        assert_eq!(utterance_rate(f32::INFINITY, 0.5, 0.0, 1.0), 0.5);
    }
}
