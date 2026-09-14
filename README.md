# Vocal Splitter — Local Chrome Extension

Separate vocals from music **locally in the browser** with the HTDemucs model. No paid API, no subscription, no audio upload.

- Input via popup, resampled to 44.1 kHz
- Runs Demucs (`demucs-web`) with ONNX Runtime Web (WebGPU, fallback to WASM)
- Outputs `*_vocals.wav` + `*_instrumental.wav`
- First run downloads ~172MB model from Hugging Face and caches it in IndexedDB:
  `https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx`

## Install in Chrome

1. `npm install`
2. `npm run build`
3. Go to `chrome://extensions`, enable **Developer mode**
4. **Load unpacked** → select the `dist/` folder
5. Pin **Vocal Splitter — Local** and pick an audio file from the popup

## Rebuild

```bash
npm install
npm run build
```

## Limitations

- Heavy model: speed depends on CPU/GPU/RAM and track length. Keep the popup open until it finishes.
- Output is WAV (use Audacity/FFmpeg for MP3).
- May be imperfect on live recordings, heavy effects, choirs, or human-like instruments.

## Privacy

Only the user-selected file is read. No access to history, cookies, or tabs. Network permission is only for downloading the public model.

## Credits

Processing core from [demucs-web](https://github.com/timcsy/demucs-web) (MIT) + [ONNX Runtime Web](https://onnxruntime.ai/). Check model license before public distribution.

---

## جداکننده صدای خواننده — افزونه محلی کروم

جداسازی وکال از موزیک بدون API و بدون آپلود، با مدل HTDemucs داخل مرورگر. در اجرای اول مدل ~۱۷۲ مگابایتی از Hugging Face دانلود و در IndexedDB کش می‌شود.
