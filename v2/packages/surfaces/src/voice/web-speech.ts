import type { RecognitionEvent, RecognizerLanguage, RecognizerStatus, SpeechRecognizerHost, SpeechSynthesizerHost, SpeechVoice, VoicePermission } from '@lazybox/platform';

/**
 * The browser's own speech services (Web Speech): recognition where the
 * browser has it (Chrome, Edge, Safari), speechSynthesis for read-aloud.
 *
 * Where audio goes is the browser's business: Chrome sends it to Google's
 * speech service unless it can recognize the language on the device
 * (`processLocally`, where offered), Safari to Apple's. The status says
 * on-device only when the browser confirms it.
 */
type ResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; processLocally?: boolean;
  onresult: ((event: { resultIndex: number; results: ResultList }) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionClass = (new () => Recognition) & { available?(options: { langs: string[]; processLocally: boolean }): Promise<string> };

function recognitionClass(): RecognitionClass | undefined {
  const scope = globalThis as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition;
}

const browserLanguage = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
/** Common recognition languages, the person's own first. Browsers do not list theirs. */
const offered = ['en-US', 'en-GB', 'fr-FR', 'fr-CA', 'de-DE', 'es-ES', 'it-IT', 'pt-BR', 'nl-NL', 'ja-JP', 'zh-CN'];
function languageName(code: string): string {
  try { return new Intl.DisplayNames([browserLanguage()], { type: 'language' }).of(code) || code; } catch { return code; }
}

async function locallyAvailable(Recognition: RecognitionClass, language: string): Promise<boolean> {
  if (typeof Recognition.available !== 'function') return false;
  try { return await Recognition.available({ langs: [language], processLocally: true }) === 'available'; } catch { return false; }
}

const errors: Record<string, string> = {
  'not-allowed': 'The microphone is blocked for this site. Allow it in your browser’s site settings.',
  'service-not-allowed': 'This browser does not allow speech recognition here.',
  'audio-capture': 'No microphone was found.',
  network: 'The browser’s speech service could not be reached.',
  'language-not-supported': 'This browser cannot recognize that language.',
  'no-speech': 'Nothing was heard.',
};

/** The Web Speech recognizer, or undefined where the browser has none. */
export function webRecognizer(): SpeechRecognizerHost | undefined {
  const Recognition = recognitionClass();
  if (!Recognition) return undefined;
  return {
    id: 'browser',
    label: 'Browser speech recognition',
    async status(language): Promise<RecognizerStatus> {
      let microphone: VoicePermission = 'not-determined';
      try {
        const state = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
        microphone = state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'not-determined';
      } catch { /* The browser asks when dictation starts. */ }
      const code = language || browserLanguage();
      return { available: true, onDevice: await locallyAvailable(Recognition, code), microphone, speech: 'granted', reason: '', language: browserLanguage() };
    },
    async languages(): Promise<RecognizerLanguage[]> {
      const own = typeof navigator !== 'undefined' ? [...navigator.languages || []] : [];
      return [...new Set([...own.filter(code => /^[a-z]{2,3}-[A-Z]{2}$/.test(code)), ...offered])].map(code => ({ code, name: languageName(code) }));
    },
    async start(options, listener: (event: RecognitionEvent) => void) {
      const recognition = new Recognition();
      recognition.lang = options.language || browserLanguage();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      if ('processLocally' in recognition && await locallyAvailable(Recognition, recognition.lang)) recognition.processLocally = true;
      let ended = false;
      recognition.onresult = event => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          listener({ kind: 'result', segment: i, text: result[0]?.transcript || '', final: result.isFinal });
        }
      };
      recognition.onerror = event => {
        if (event.error === 'aborted') return;
        listener({ kind: 'error', code: event.error, message: errors[event.error] || event.message || `Speech recognition failed (${event.error}).` });
      };
      recognition.onend = () => { if (!ended) { ended = true; listener({ kind: 'end' }); } };
      recognition.onspeechstart = () => listener({ kind: 'activity', speaking: true });
      recognition.onspeechend = () => listener({ kind: 'activity', speaking: false });
      recognition.start();
      return {
        async stop() { recognition.stop(); },
        async cancel() { recognition.abort(); if (!ended) { ended = true; listener({ kind: 'end' }); } },
      };
    },
  };
}

type Synthesis = {
  getVoices(): { voiceURI: string; name: string; lang: string; default?: boolean }[];
  speak(utterance: unknown): void; cancel(): void;
  addEventListener?(type: 'voiceschanged', listener: () => void): void;
  removeEventListener?(type: 'voiceschanged', listener: () => void): void;
};
type UtteranceClass = new (text: string) => { rate: number; lang: string; voice: unknown; onend: (() => void) | null; onerror: (() => void) | null };

/** speechSynthesis, or undefined where the browser has none. */
export function webSynthesizer(): SpeechSynthesizerHost | undefined {
  const scope = globalThis as unknown as { speechSynthesis?: Synthesis; SpeechSynthesisUtterance?: UtteranceClass };
  const synthesis = scope.speechSynthesis, Utterance = scope.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance) return undefined;
  // Some browsers fill the list a moment after the page loads.
  const loaded = () => new Promise<ReturnType<Synthesis['getVoices']>>(resolve => {
    const now = synthesis.getVoices();
    if (now.length) { resolve(now); return; }
    const done = () => { synthesis.removeEventListener?.('voiceschanged', done); resolve(synthesis.getVoices()); };
    synthesis.addEventListener?.('voiceschanged', done);
    setTimeout(done, 1000);
  });
  return {
    async voices(): Promise<SpeechVoice[]> {
      return (await loaded()).map(voice => ({ id: voice.voiceURI, name: voice.name, language: voice.lang }));
    },
    async speak(text, { voice, rate }) {
      const voices = voice ? await loaded() : [];
      await new Promise<void>(resolve => {
        const utterance = new Utterance(text);
        utterance.rate = rate;
        const chosen = voices.find(v => v.voiceURI === voice);
        if (chosen) { utterance.voice = chosen; utterance.lang = chosen.lang; }
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        synthesis.cancel();
        synthesis.speak(utterance);
      });
    },
    async stop() { synthesis.cancel(); },
  };
}
