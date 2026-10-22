# Speaks each narration line to a wav file and records its length. python tts.py <voice> <speed> <lines.json> <outdir>
import json, sys, os, soundfile as sf
from kokoro_onnx import Kokoro
voice, speed, lines, out = sys.argv[1], float(sys.argv[2]), json.load(open(sys.argv[3])), sys.argv[4]
os.makedirs(out, exist_ok=True)
k = Kokoro('kokoro-v1.0.onnx', 'voices-v1.0.bin'); durs = {}
for key, text in lines.items():
    lang = 'en-gb' if voice.startswith('b') else 'en-us'
    audio, sr = k.create(text, voice=voice, speed=speed, lang=lang)
    sf.write(os.path.join(out, key + '.wav'), audio, sr); durs[key] = round(len(audio) / sr, 2)
    print(key, durs[key])
json.dump(durs, open(os.path.join(out, 'durations.json'), 'w'))
