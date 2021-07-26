import {log} from "./utils/logger";
import {SelfieSegmentation} from "@mediapipe/selfie_segmentation";
import {Camera} from "@mediapipe/camera_utils";


const logger = log('ql-sfu-client', 'BeautifyVideoClient');

// 背景替换类型
const REPLACE_BACKGROUND_TYPE_NONE = 0    // 不替换背景
const REPLACE_BACKGROUND_TYPE_BLUR = 1    // 模糊
const REPLACE_BACKGROUND_TYPE_IMAGE = 2   // 替换图

export default class BeautifyVideoClient {

  /**
   * 构造方法
   * @param mediaStreamCallBack 视频流变化时的回调
   * @param colorUpdatedCallBack 颜色变化时的回调
   */
  constructor({mediaStreamCallBack, colorUpdatedCallBack}) {
    this._mediaStreamCallBack = mediaStreamCallBack;
    this._colorUpdatedCallBack = colorUpdatedCallBack;
    this._initElements();
  }

  /**
   * 更换参数
   * @param mediaStream 更换原始视频
   * @param canvas 更换显示的canvas
   * @param frameRate 更换获取的帧数
   */
  upsertParams({mediaStream, canvas, frameRate}) {
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
    if (shouldReCapture) {
      this._refreshVideoStream()
    }
  }

  /**
   * 更换背景
   * @param imgUrl 背景图片的url
   */
  replaceBackImg(imgUrl) {
    logger.info(`start replace background image with image ${imgUrl}`);
    if (imgUrl) {
      if (imgUrl !== this._bkImageEle.src) {
        this._bkImageEle.src = imgUrl;
        this._bkImageEle.onload = () => {
          this._replaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
          this._startDrawBack();
        };
      } else {
        this._replaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
        this._startDrawBack();
      }
    }
  }

  /**
   * 模糊背景
   * @param radius 模糊半径
   */
  blurBack(radius) {
    logger.info(`start blur with radius ${radius}`)
    if (radius) {
      this._replaceType = REPLACE_BACKGROUND_TYPE_BLUR;
      this._blurradius = radius;
      this._startDrawBack();
    }
  }

  /**
   * 是否使用绿幕
   * @param use true: 使用, false: 不使用
   */
  useGreenScreen(use) {
    this._shouldReplaceColor = use
    this._startDrawBack()
  }

  /**
   * 不替换背景
   */
  clearBack() {
    logger.info(`clear background`)
    this._replaceType = REPLACE_BACKGROUND_TYPE_NONE;
    this._startDrawBack()
  }

  /**
   * 开始选颜色，只有用户选择了使用绿幕，并且背景时图片时才可以选择颜色
   * @param restoreVideo 是否要恢复视频原样
   */
  pickColor(restoreVideo = false) {
    if (this._replaceType === REPLACE_BACKGROUND_TYPE_IMAGE && this._shouldReplaceColor === true) {
      if (restoreVideo === true) {
        this._shouldDrawBack = false;
        setTimeout(() => {
          window.addEventListener("click", this._windowOnClick)
        }, 0)
      }
      this._showCanvas.addEventListener("click", this._updateColor.bind(this), {once: true});
    }
  }

  /**
   * 关闭绘制页面，如果不替换背景，就把原来的流发回去
   */
  disappear() {
    if (this._replaceType === REPLACE_BACKGROUND_TYPE_NONE) {
      this._shouldSendOriginVideo = true
      this._closeDrawColorTimer()
    }
    this._refreshVideoStream()
  }

  /**
   * 释放
   */
  close() {
    this._closeDrawColorTimer()
    this._selfieSegmentation.close();
    this._selfieSegmentation = undefined;
    this._camera = undefined;
    this._showCanvasCtx = undefined;
    this._showCanvas = undefined;
    this._originVideo.srcObject = undefined;
    this._originVideo = undefined;
    this._bkImageEle = undefined;
    this._handleVideoCanvasCtx = undefined;
    this._handleVideoCanvas = undefined;
    this._handleImageCanvasCtx = undefined;
    this._handleImageCanvas = undefined;
    this._imageFrame = undefined;
  }

  _initElements() {

    // 替换类型
    this._replaceType = REPLACE_BACKGROUND_TYPE_NONE;
    this._width = 640;
    this._height = 360;
    this._frameRate = 30;
    this._blurRadius = 15;

    // 应不应该画背景
    this._shouldDrawBack = false

    // 是否要替换颜色（用户是否选择了绿幕）
    this._shouldReplaceColor = false

    // 是否应该把原来流返回去
    this._shouldSendOriginVideo = true

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

    // 设置window点击事件
    this._windowOnClick = this._resetShouldDrawBack.bind(this);
  }

  _refreshVideoStream() {
    if (this._mediaStreamCallBack) {
      try {
        if (this._shouldSendOriginVideo === true) {
          if (this._originVideo && this._originVideo.srcObject)
          this._mediaStreamCallBack(this._originVideo.srcObject)
        } else {
          if (this._showCanvas)
            this._mediaStreamCallBack(this._showCanvas.captureStream(this._frameRate))
        }
      } catch (e) {
        logger.error(`call mediaStream error, eMsg: ${e}`)
      }
    }
  }

  _startDrawBack() {
    this._shouldSendOriginVideo = false
    switch (this._replaceType) {
      case REPLACE_BACKGROUND_TYPE_NONE:
        this._shouldDrawBack = false
        break
      case REPLACE_BACKGROUND_TYPE_IMAGE:
        if (this._shouldReplaceColor === true) {
          this._handleImageCanvasCtx.clearRect(0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          this._handleImageCanvasCtx.drawImage(this._bkImageEle, 0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          this._imageFrame = this._handleImageCanvasCtx.getImageData(0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          this._shouldDrawBack = true
          this._openDrawColorTimer();
        } else {
          this._closeDrawColorTimer()
          this._shouldDrawBack = true;
          this._handleVideo()
        }
        break
      case REPLACE_BACKGROUND_TYPE_BLUR:
        this._closeDrawColorTimer()
        this._shouldDrawBack = true;
        this._handleVideo()
        break
    }
    this._refreshVideoStream()
  }

  _openDrawColorTimer() {
    if (!this._computeInterval) {
      this._computeInterval = setInterval(()=>{
        this._handleVideo()
      }, 60)
    }
  }

  _closeDrawColorTimer() {
    if (this._computeInterval) {
      clearInterval(this._computeInterval)
      this._computeInterval = undefined
    }
  }

  _handleVideo() {
    // 如果是模糊背景或者不应该替换颜色，就执行人脸识别
    if ((this._replaceType === REPLACE_BACKGROUND_TYPE_BLUR || this._shouldReplaceColor === false)) {
      if (!this._selfieSegmentation) {
        try {
          this._selfieSegmentation = new SelfieSegmentation({ locateFile: (file) => {
              return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
            }
          });
          this._selfieSegmentation.setOptions({
            modelSelection: 1,
          });
          this._selfieSegmentation.onResults((results) => {
            if (this._showCanvasCtx) {
              if (this._shouldDrawBack === true) {
                this._showCanvasCtx.save();
                this._showCanvasCtx.clearRect(0, 0, this._showCanvas.width, this._showCanvas.height);
                // 绘制背景
                switch (this._replaceType) {
                  case REPLACE_BACKGROUND_TYPE_BLUR:
                    this._showCanvasCtx.filter = `blur(${this._blurradius}px)`
                    this._showCanvasCtx.drawImage(results.image, 0, 0, this._showCanvas.width, this._showCanvas.height)
                    this._showCanvasCtx.filter = "none"
                    break
                  case REPLACE_BACKGROUND_TYPE_IMAGE:
                    this._showCanvasCtx.drawImage(this._bkImageEle, 0, 0, this._showCanvas.width, this._showCanvas.height)
                    break
                  default:
                    break
                }
                // 绘制模型
                this._showCanvasCtx.globalCompositeOperation = 'destination-out';
                this._showCanvasCtx.drawImage(results.segmentationMask, 0, 0, this._showCanvas.width, this._showCanvas.height);
                // 绘制人
                this._showCanvasCtx.globalCompositeOperation = 'destination-over';
                this._showCanvasCtx.drawImage(results.image, 0, 0, this._showCanvas.width, this._showCanvas.height);
                this._showCanvasCtx.restore();
              } else {
                this._showCanvasCtx.drawImage(results.image, 0, 0, this._showCanvas.width, this._showCanvas.height);
              }
            }
          });
        } catch (e) {
          this._selfieSegmentation = undefined
        }
      }
      if (!this._camera && this._selfieSegmentation) {
        this._camera = new Camera(this._originVideo, {
          onFrame: async () => {
            // 如果是模糊背景或者不应该替换颜色，并且不是发原流给用户时
            if (this._shouldSendOriginVideo === false && (this._replaceType === REPLACE_BACKGROUND_TYPE_BLUR || this._shouldReplaceColor === false) && this._selfieSegmentation)
              await this._selfieSegmentation.send({image: this._originVideo})
          },
          width: 480,
          height: 270
        });
        this._camera.start().catch(reason => {
          logger.error(`start mediapipe camera error, eMsg: ${reason}`)
          this._camera = undefined
        })
      }
    } else {
      // 执行替换颜色，不发原流给用户时才执行，
      if (this._shouldSendOriginVideo === false && this._originVideo.srcObject) {
        this._handleVideoCanvasCtx.drawImage(this._originVideo, 0, 0, this._handleVideoCanvas.width, this._handleVideoCanvas.height);
        let frame = this._handleVideoCanvasCtx.getImageData(0, 0, this._handleVideoCanvas.width, this._handleVideoCanvas.height);
        let l = frame.data.length / 4;
        if (this._shouldDrawBack === true) {
          for (let i = 0; i < l; i++) {
            let rIndex = i * 4;
            let gIndex = rIndex + 1;
            let bIndex = rIndex + 2;
            let r = frame.data[rIndex];
            let g = frame.data[gIndex];
            let b = frame.data[bIndex];
            let hslResult = this._rgbToHsl(r, g, b)
            if (((hslResult.h >= this._availbleH[0] && hslResult.h <= this._availbleH[1]) ||
              ((hslResult.h + 1) >= this._availbleH[0] && (hslResult.h + 1) <= this._availbleH[1]) ||
              ((hslResult.h + 2) >= this._availbleH[0] && (hslResult.h + 2) <= this._availbleH[1]))
              && (hslResult.s >= this._availbleS[0] && hslResult.s <= this._availbleS[1])
              && (hslResult.l >= this._availbleL[0] && hslResult.l <= this._availbleL[1])
            ) {
              frame.data[rIndex] = this._imageFrame.data[rIndex];
              frame.data[gIndex] = this._imageFrame.data[gIndex];
              frame.data[bIndex] = this._imageFrame.data[bIndex];
            }
          }
        }
        this._handleVideoCanvasCtx.clearRect(0, 0, this._handleVideoCanvas.width, this._handleVideoCanvas.height);
        this._handleVideoCanvasCtx.putImageData(frame, 0, 0);
        this._showCanvasCtx.clearRect(0, 0, this._showCanvas.width, this._showCanvas.height);
        this._showCanvasCtx.drawImage(this._handleVideoCanvas, 0, 0, this._showCanvas.width, this._showCanvas.height)
        // this._showCanvasCtx.putImageData(frame, 0, 0, 0, 0, this._showCanvas.width, this._showCanvas.height);
      }
    }
  }

  _resetShouldDrawBack() {
    window.removeEventListener("click", this._windowOnClick)
    this._shouldDrawBack = true
  }

  _updateColor(event) {

    let rCount = 0
    let gCount = 0
    let bCount = 0

    let canvasW = this._showCanvas.width
    let canvasH = this._showCanvas.height
    let canvasSW = parseInt(this._showCanvas.style.width.replace("px", ""))
    let canvasSH = parseInt(this._showCanvas.style.height.replace("px", ""))

    let round = 6
    let offset = round/2
    let x = event.offsetX * (canvasW/canvasSW) - offset
    let y = event.offsetY * (canvasH/canvasSH) - offset
    let frame = this._showCanvasCtx.getImageData(x < 0 ? 0 : x, y < 0 ? 0 : y, round, round)
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

    if (this._colorUpdatedCallBack)
      this._colorUpdatedCallBack({r, g, b})

    this._shouldDrawBack = true
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