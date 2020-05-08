export default class SoundMeter {
  constructor(context, stream, callback, frequency = 200) {
    this.context = context;
    this.callback = callback;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 32;
    this.mic = context.createMediaStreamSource(stream);
    this.mic.connect(this.analyser);
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);

    this.intervalId = window.setInterval(() => {
      if (this.context.status === undefined || this.context.status === 'suspend') {
        this.context.resume()
      }
      this.analyser.getByteFrequencyData(this.dataArray);
      // let strength = 0
      // this.dataArray.forEach(v => {
      //   if (v > 0)
      //     strength += Math.abs(v - 128)
      // })
      if (this.callback)
        this.callback(this.dataArray[3])
    }, frequency)
  }
}

SoundMeter.prototype.stop = function() {
  window.clearInterval(this.intervalId);
  try {
    this.mic.disconnect()
  } catch (e) {}
  this.mic = undefined;
  try {
    this.analyser.disconnect()
  } catch (e) {}
  this.analyser = undefined;
  this.callback = undefined;
};
