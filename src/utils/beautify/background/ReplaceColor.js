import {log} from '../../logger'

const logger = log('ql-sfu-client', 'ReplaceColor');

export default class ReplaceColor {

  /**
   * 构造函数
   * @param mediaStreamCallback 视频流回调
   * @param colorUpdateCallback 选择颜色的回调
   */
  constructor({mediaStreamCallback, colorUpdateCallback}) {
    this._mediaStreamCallback = mediaStreamCallback;
    this._colorUpdateCallback = colorUpdateCallback;

    this._width = 640;
    this._height = 360;
    this._frameRate = 30;

    // 应不应该画
    this._shouldDraw = true

    // 初始化色相、饱和度、亮度
    this._hValue = 1.167;
    this._sValue = 0.1;
    this._lValue = 0.2;
    this._availbleH = [0.4, 0.6];
    this._availbleS = [0.4, 0.6];
    this._availbleL = [0.4, 0.6];

    // 初始化原始视频
    this._originVideo = document.createElement("VIDEO");
    this._originVideo.autoplay = true;
    this._originVideo.setAttribute("width", '320');
    this._originVideo.setAttribute("height", '180');

    // 初始化处理视频的frame
    this._handleVideoCanvas = document.createElement("CANVAS");
    this._handleVideoCanvas.width = `${this._width}`
    this._handleVideoCanvas.height = `${this._height}`
    this._handleVideoCanvas.style.width = `${this._width}px`
    this._handleVideoCanvas.style.height = `${this._height}px`
    this._handleVideoCanvasCtx = this._handleVideoCanvas.getContext('2d');

    // 初始化需要改变的背景图
    this._bkImageEle = document.createElement("img")
    this._bkImageEle.crossOrigin = "Anonymous";

    // 初始化处理图片的canvas
    this._handleImageCanvas = document.createElement("CANVAS");
    this._handleImageCanvas.width = `${this._width}`
    this._handleImageCanvas.height = `${this._height}`
    this._handleImageCanvas.style.width = `${this._width}px`
    this._handleImageCanvas.style.height = `${this._height}px`
    this._handleImageCanvasCtx = this._handleImageCanvas.getContext('2d');

    // 需要展示结果的canvas
    this._showCanvas = undefined
    this._showCanvasCtx = undefined

    // 设置timer
    this._computeInterval = undefined
  }

  /**
   * 设置绘制参数，设置后会重新给用户流
   * @param mediaStream 源视频流
   * @param canvas 画板
   * @param frameRate 帧率
   */
  resetParams({mediaStream, canvas, frameRate}) {
    logger.info(`reset params mediaStream ${mediaStream} canvas ${canvas} frameRate ${frameRate}`)
    let shouldReCapture = false
    if (mediaStream) {
      this._originVideo.srcObject = mediaStream
      shouldReCapture = true
    }
    if (canvas) {
      this._showCanvas = canvas
      this._showCanvasCtx = this._showCanvas.getContext('2d');
      shouldReCapture = true
    }
    if (frameRate) {
      this._frameRate = frameRate
      shouldReCapture = true
    }
    if (shouldReCapture && this._mediaStreamCallback) {
      try {
        this._mediaStreamCallback(this._showCanvas.captureStream(this._frameRate))
      } catch (e) {
        logger.error(`call mediaStream error, eMsg: ${e}`)
      }
    }
  }

  /**
   * 更换图片并开始绘制
   * @param imgUrl 不传则只绘制视频，传则替换背景
   */
  startDrawBackgroundImage(imgUrl) {
    if (imgUrl) {
      if (imgUrl !== this._bkImageEle.src) {
        this._bkImageEle.src = imgUrl
        this._bkImageEle.onload = () => {
          this._handleImageCanvasCtx.drawImage(this._bkImageEle, 0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          this._imageFrame = this._handleImageCanvasCtx.getImageData(0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          this._shouldDraw = true
          this._startTimer();
        }
      } else {
        this._shouldDraw = true
        this._startTimer()
      }
    } else {
      this._shouldDraw = false
      this._bkImageEle.src = undefined
    }
  }

  /**
   * 开始取色
   * @param stopDraw 是否应该停止绘背景
   */
  pickColor(stopDraw) {
    if (stopDraw) {
      this._shouldDraw = false
      window.addEventListener("click", () => {
        this._shouldDraw = true
      }, {once: true})
    }
    this._showCanvas.addEventListener("click", this._updateColor.bind(this), {once: true});
  }

  /**
   * 停止绘制canvas，如果没有背景图了，就销毁定时器，并把原流给客户端
   * @param force 是否强制停止
   */
  stop(force) {
    logger.info(`stop replace color, force ${force}`)
    if (!this._bkImageEle.src || force === true) {
      clearInterval(this._computeInterval)
      this._computeInterval = undefined
      // 清除视频、图片，并回调上层新的视频
      let mediaStream = this._originVideo.srcObject;
      this._originVideo.srcObject = undefined;
      this._bkImageEle.src = undefined;
      if (this._mediaStreamCallback) {
        try {
          this._mediaStreamCallback(mediaStream)
        } catch (e) {
          logger.error(`call mediaStream error after stop media, eMsg: ${e}`)
        }
      }
    }
  }

  // 释放
  close() {
    this.stop(true)
    this._showCanvas = undefined;
    this._showCanvasCtx = undefined;
    this._handleVideoCanvasCtx = undefined;
    this._handleVideoCanvas = undefined;
    this._handleImageCanvasCtx = undefined;
    this._handleImageCanvas = undefined;
    this._originVideo.srcObject = undefined;
    this._originVideo = undefined;
    this._imageFrame = undefined;
  }

  _startTimer() {
    if (!this._computeInterval) {
      this._computeInterval = setInterval(()=>{
        this._computeFrame()
      }, 60)
    }
  }

  _computeFrame() {
    if (this._originVideo.srcObject) {
      this._handleVideoCanvasCtx.drawImage(this._originVideo, 0, 0, this._handleVideoCanvas.width, this._handleVideoCanvas.height);
      let frame = this._handleVideoCanvasCtx.getImageData(0, 0, this._handleVideoCanvas.width, this._handleVideoCanvas.height);
      let l = frame.data.length / 4;

      if (this._shouldDraw === true) {
        for (let i = 0; i < l; i++) {
          let r = frame.data[i * 4 + 0];
          let g = frame.data[i * 4 + 1];
          let b = frame.data[i * 4 + 2];
          let hslResult = this._rgbToHsl(r, g, b)
          if (((hslResult.h >= this._availbleH[0] && hslResult.h <= this._availbleH[1]) ||
            ((hslResult.h + 1) >= this._availbleH[0] && (hslResult.h + 1) <= this._availbleH[1]) ||
            ((hslResult.h + 2) >= this._availbleH[0] && (hslResult.h + 2) <= this._availbleH[1]))
            && (hslResult.s >= this._availbleS[0] && hslResult.s <= this._availbleS[1])
            && (hslResult.l >= this._availbleL[0] && hslResult.l <= this._availbleL[1])
          ) {
            frame.data[i * 4 + 0] = this._imageFrame.data[i * 4 + 0];
            frame.data[i * 4 + 1] = this._imageFrame.data[i * 4 + 1];
            frame.data[i * 4 + 2] = this._imageFrame.data[i * 4 + 2];
          }
        }
      }
      this._showCanvasCtx.putImageData(frame, 0, 0);
    }
  }

  _updateColor(event) {

    let rCount = 0
    let gCount = 0
    let bCount = 0

    let round = 6
    let offset = round * round/2
    let frame = this._showCanvasCtx.getImageData((event.offsetX - offset) < 0 ? 0 : (event.offsetX - offset), (event.offsetY - offset) < 0 ? 0 : (event.offsetY - offset), round, round)
    let l = frame.data.length / 4;
    for (let i = 0; i < l; i++) {
      rCount += frame.data[i * 4 + 0];
      gCount += frame.data[i * 4 + 1];
      bCount += frame.data[i * 4 + 2];
    }
    let r = rCount/l
    let g = gCount/l
    let b = bCount/l

    // 获取用户点击的颜色的hsl
    let result = this._rgbToHsl(r, g, b)
    let ch = result.h + 1
    let cs = result.s
    let cl = result.l

    this._availbleH = [ch - this._hValue, ch + this._hValue]
    this._availbleS = [cs - this._sValue, cs + this._sValue]
    this._availbleL = [cl - this._lValue, cl + this._lValue]

    if (this._colorUpdateCallback)
      this._colorUpdateCallback({r, g, b})

    this._shouldDraw = true
  }

  _rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    let max = Math.max(r, g, b);
    let min = Math.min(r, g, b);
    let h, s, l = (max + min)/2;
    if (max === min) {
      h = s = 0;
    } else {
      let d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return {h, s, l}
  }

}