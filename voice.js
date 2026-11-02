// Voice dictation into a textarea using the browser's speech recognition
// (Chrome on Android sends the audio to Google for transcription).
// It listens one phrase at a time and restarts itself, which is steadier on
// Android than continuous mode, until stop() is called.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = Boolean(Recognition);

export class Dictation {
  constructor(textarea, onStatus) {
    this.textarea = textarea;
    this.onStatus = onStatus || (() => {});
    this.listening = false;
    this.rec = null;
  }

  start() {
    if (!Recognition || this.listening) return false;
    this.listening = true;
    this.listen();
    return true;
  }

  stop() {
    this.listening = false;
    if (this.rec) {
      try {
        this.rec.stop();
      } catch {
        // already stopped
      }
    }
    this.onStatus('', false);
  }

  listen() {
    const rec = new Recognition();
    this.rec = rec;
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.insert(r[0].transcript);
        else interim += r[0].transcript;
      }
      this.onStatus(interim ? `Hearing: ${interim}` : 'Listening', true);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.listening = false;
        this.onStatus('Microphone blocked. Allow it in Chrome site settings.', false);
      } else if (e.error === 'network') {
        this.listening = false;
        this.onStatus('Voice needs an internet connection.', false);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.onStatus(`Voice stopped (${e.error}).`, false);
      }
    };
    rec.onend = () => {
      if (this.listening) setTimeout(() => this.listening && this.listen(), 120);
    };
    try {
      rec.start();
      this.onStatus('Listening', true);
    } catch {
      this.listening = false;
      this.onStatus('Could not start the microphone.', false);
    }
  }

  // Puts the words at the cursor, with a space if needed.
  insert(text) {
    const words = text.trim();
    if (!words) return;
    const ta = this.textarea;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    ta.setRangeText(sep + words, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
