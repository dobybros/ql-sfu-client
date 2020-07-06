/**
 * 0 ~ 255
 */

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
      if (this.callback) {
        // 0 ~ 255 to 0 ~ 100
        let volume = 20 * this.dataArray[3] / 51;
        this.callback(volume)
      }
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
