/**
 * 0 ~ 255
 * note: the track must be clone if it is local track
 */

export default class SoundMeter {
  constructor(context, stream, callback, frequency = 200, isCloned = false) {
    this.context = context;
    this.callback = callback;
    this.isCloned = isCloned;
    if (isCloned === true)
      this.stream = stream
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
        // console.log(`${this.dataArray[0]}  ${this.dataArray[1]}  ${this.dataArray[2]}  ${this.dataArray[3]}  ${this.dataArray[4]}  ${this.dataArray[5]}  ${this.dataArray[6]}  ${this.dataArray[7]}
        //   ${this.dataArray[8]}  ${this.dataArray[9]}  ${this.dataArray[10]}  ${this.dataArray[11]}  ${this.dataArray[12]}  ${this.dataArray[13]}  ${this.dataArray[14]}  ${this.dataArray[15]}`)
        this.callback(this.dataArray[4])
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
  try {
    if (this.isCloned === true && this.stream)
      while (this.stream.getTracks().length > 0) {
        let track = this.stream.getTracks()[0]
        this.stream.removeTrack(track)
        track.stop()
      }
  } catch (e) {}
  this.analyser = undefined;
  this.callback = undefined;
  this.context = undefined;
};
