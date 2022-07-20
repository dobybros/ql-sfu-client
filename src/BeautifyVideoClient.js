import {log} from "./utils/logger";
import {SelfieSegmentation} from "@mediapipe/selfie_segmentation";


const logger = log('ql-sfu-client', 'BeautifyVideoClient');

// 背景替换类型
const REPLACE_BACKGROUND_TYPE_NONE = 0    // 不替换背景
const REPLACE_BACKGROUND_TYPE_BLUR = 1    // 模糊
const REPLACE_BACKGROUND_TYPE_IMAGE = 2   // 替换图
const REPLACE_BACKGROUND_TYPE_VIDEO = 3   // 替换视频

// 默认帧数
const DEFAULT_FRAME_RATE = 30

// 默认宽度
const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 360

export default class BeautifyVideoClient {

  /**
   * 构造方法
   * @param mediaStreamCallBack 视频流变化时的回调，回调一个视频流
   * @param colorUpdatedCallBack 颜色变化时的回调，为我有绿幕做准备的，但是效果不好，所以不打算做这个
   */
  constructor({mediaStreamCallBack, colorUpdatedCallBack}) {
    this._mediaStreamCallBack = mediaStreamCallBack;
    this._colorUpdatedCallBack = colorUpdatedCallBack;
    this._initElements();
  }

  /**
   * 更换参数
   * @param mediaStream 更换原始视频
   * @param canvas 更换展示结果的canvas
   */
  upsertParams({mediaStream, canvas}) {
    logger.info(`reset params mediaStream ${mediaStream} canvas ${canvas}`)
    if (mediaStream) {
      // 如果现存的流与原始流deviceId不一样或者帧数不一样就就重新获取流（暂时先只比较deviceId）
      let originDeviceId = this._getStreamDeviceId(mediaStream)
      let originFrameRate = this._getStreamFrameRate(mediaStream, false)
      let curDeviceId = this._getStreamDeviceId(this._originVideo.srcObject)
      let curFrameRate = this._getStreamFrameRate(this._originVideo.srcObject, false)
      if ((!curDeviceId || curDeviceId !== originDeviceId) || (!curFrameRate || curFrameRate !== originFrameRate)) {
        let constraints = {
          video : {
            width : DEFAULT_WIDTH,
            height : DEFAULT_HEIGHT,
            frameRate : originFrameRate,
            deviceId : {exact : originDeviceId}
          },
          audio : false
        };
        navigator.mediaDevices.getUserMedia(constraints).then((mediaStream) => {
          if (!this._originVideo.srcObject) {
            this._originVideo.srcObject = mediaStream
          } else {
            this._originVideo.srcObject.addTrack(mediaStream.getVideoTracks()[0])
            if (this._originVideo.srcObject.getVideoTracks().length > 1)
              this._originVideo.srcObject.removeTrack(this._originVideo.srcObject.getVideoTracks()[0])
          }
        });
      }
      let shouldCaptureVideoStream = false
      if (!this._originMediaStream)
        shouldCaptureVideoStream = true
      this._originMediaStream = mediaStream
      if (shouldCaptureVideoStream)
        this._reCaptureVideoStream()
    }
    if (canvas && canvas !== this._showCanvas) {
      // 如果更换了canvas，就重新捕捉需要给上层的流
      this._showCanvas = canvas
      this._showCanvasCtx = this._showCanvas.getContext('2d');
      this._shouldReCapture = true
      if (this._originMediaStream)
        this._reCaptureVideoStream()
    }
  }

  /**
   * 打开模糊背景设置页面时调用
   */
  show() {
    if (this._replaceType === REPLACE_BACKGROUND_TYPE_NONE) {
      if (!this._checkVideoStreamIsAvailable(this._originVideo.srcObject) && this._checkVideoStreamIsAvailable(this._originMediaStream)) {
        this.upsertParams({mediaStream: this._originMediaStream})
      }
      this._shouldReCapture = true
      this.blankBack()
    }
  }

  /**
   * 更换背景
   * @param imgSrc 背景图片的src
   */
  replaceBackImg(imgSrc) {
    logger.info(`start replace background image with image ${imgSrc}`);
    if (imgSrc) {
      if (imgSrc !== this._bkImageEle.src) {
        this._bkImageEle.src = imgSrc;
        this._replaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
        this._startDrawBack();
      } else {
        this._replaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
        this._startDrawBack();
      }
    }
  }

  /**
   * 更换视频
   * @param videoSrc 背景视频的src
   */
  replaceBackVideo(videoSrc) {
    logger.info(`start replace background video with video ${videoSrc}`);
    if (videoSrc) {
      if (videoSrc !== this._bkVideoEle.src) {
        this._bkVideoEle.src = videoSrc;
        this._replaceType = REPLACE_BACKGROUND_TYPE_VIDEO;
        this._startDrawBack();
      } else {
        this._replaceType = REPLACE_BACKGROUND_TYPE_VIDEO;
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
    this._useGreenScreen = use
    this._startDrawBack()
    setTimeout(() => {
      if (this._availbleH[0] === -1) {
        this._updateColor({offsetX: 30, offsetY: 30})
      }
    }, 500)
  }

  /**
   * 使用空白背景
   */
  blankBack() {
    logger.info(`use blank background`)
    this._replaceType = REPLACE_BACKGROUND_TYPE_NONE;
    this._startDrawBack()
  }

  /**
   * 开始选颜色，只有用户选择了使用绿幕，并且背景时图片时才可以选择颜色
   * @param restoreVideo 是否要恢复视频原样
   */
  pickColor(restoreVideo = false) {
    if ((this._replaceType === REPLACE_BACKGROUND_TYPE_IMAGE || this._replaceType === REPLACE_BACKGROUND_TYPE_VIDEO) && this._useGreenScreen === true) {
      if (restoreVideo === true) {
        this._shouldDrawBack = false;
        setTimeout(() => {
          // 这个事件是为了当用户处于选择颜色状态时，如果点了其他地方，就相当于取消选择color状态
          window.addEventListener("click", this._windowOnClick)
        }, 0)
      }
      this._showCanvas.addEventListener("click", this._updateColor.bind(this), {once: true});
    }
  }

  /**
   * 关闭视频，用于用户关闭视频时的调用，此时将停止描绘画面
   */
  closeVideo() {
    this._closeVideoTracks()
  }

  /**
   * 关闭绘制页面，如果不替换背景，就把原来的流发回去，用户关闭设置页面时需要调用这个
   */
  disappear() {
    this._disappear = true
    if (this._replaceType === REPLACE_BACKGROUND_TYPE_NONE) {
      this._closeDrawColorTimer()
      this._shouldReCapture = true
      this._reCaptureVideoStream()
      this._closeVideoTracks()
    }
  }

  /**
   * 释放
   */
  close() {
    this._closeDrawColorTimer()
    this._shouldRequestAnimation = false
    if (this._selfieSegmentation) {
      this._selfieSegmentation.close();
      this._selfieSegmentation = undefined;
    }
    this._showCanvasCtx = undefined;
    this._showCanvas = undefined;
    this._closeVideoTracks()
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

    // 原视频流
    this._originMediaStream = undefined;

    // 应不应该画背景，用于用户选择"我有绿幕"时是否应该绘制背景，比如用户如果点击选择颜色或者不替换背景，那么就不应该画背景
    this._shouldDrawBack = false

    // 是否要替换颜色（用户是否选择了绿幕）
    this._useGreenScreen = false

    // 是否正在请求动画
    this._isRequestAnimation = false

    // 是否应该请求动画
    this._shouldRequestAnimation = false

    // 是否应该重新捕捉视频
    this._shouldReCapture = false

    // 是否关闭了canvas选择框
    this._disappear = true

    // 初始化色相、饱和度、亮度
    this._hValue = 1.167;
    this._sValue = 0.1;
    this._lValue = 0.2;
    this._availbleH = [-1, -1];
    this._availbleS = [-1, -1];
    this._availbleL = [-1, -1];

    // 初始化原始视频，当更新mediaStream时，会重新根据参数获取视频流，因为这里的视频不宜太大或太小，所以固定了大小
    this._originVideo = document.createElement("VIDEO");
    this._originVideo.autoplay = true;
    this._originVideo.setAttribute("width", '320');
    this._originVideo.setAttribute("height", '180');

    // 初始化处理视频的frame
    this._handleVideoCanvas = document.createElement("CANVAS");
    this._handleVideoCanvas.width = `${DEFAULT_WIDTH}`
    this._handleVideoCanvas.height = `${DEFAULT_HEIGHT}`
    this._handleVideoCanvas.style.width = `${DEFAULT_WIDTH}px`
    this._handleVideoCanvas.style.height = `${DEFAULT_HEIGHT}px`
    this._handleVideoCanvasCtx = this._handleVideoCanvas.getContext('2d');

    // 初始化需要改变的背景图
    this._bkImageEle = document.createElement("img")
    this._bkImageEle.crossOrigin = "Anonymous";

    // 初始化需要改变的视频
    this._bkVideoEle = document.createElement("video")
    this._bkVideoEle.setAttribute("autoplay", '');
    this._bkVideoEle.setAttribute("playsinline", '');
    this._bkVideoEle.setAttribute("loop", 'loop');
    this._bkVideoEle.crossOrigin = "Anonymous";
    this._bkVideoEle.addEventListener("canplay", (event) => {
      // if (this._replaceType === REPLACE_BACKGROUND_TYPE_VIDEO)
      // this._replaceType = REPLACE_BACKGROUND_TYPE_VIDEO
      //   this._startDrawBack();
    })

    // 初始化处理图片的canvas
    this._handleImageCanvas = document.createElement("CANVAS");
    this._handleImageCanvas.width = `${DEFAULT_WIDTH}`
    this._handleImageCanvas.height = `${DEFAULT_HEIGHT}`
    this._handleImageCanvas.style.width = `${DEFAULT_WIDTH}px`
    this._handleImageCanvas.style.height = `${DEFAULT_HEIGHT}px`
    this._handleImageCanvasCtx = this._handleImageCanvas.getContext('2d');

    // 需要展示结果的canvas
    this._showCanvas = undefined
    this._showCanvasCtx = undefined

    // 设置timer
    this._computeInterval = undefined

    // 设置window点击事件
    this._windowOnClick = this._resetShouldDrawBack.bind(this);
  }

  _reCaptureVideoStream() {
    if (this._mediaStreamCallBack && this._shouldReCapture === true) {
      this._shouldReCapture = false
      try {
        if (this._replaceType === REPLACE_BACKGROUND_TYPE_NONE && this._disappear === true) {
          this._mediaStreamCallBack(this._originMediaStream)
        } else {
          if (this._showCanvas) {
            this._mediaStreamCallBack(this._showCanvas.captureStream(this._getStreamFrameRate(this._originMediaStream, true)))
          } else {
            logger.warn(`should callback canvas, but canvas is null`)
            this._mediaStreamCallBack(this._originMediaStream)
          }
        }
      } catch (e) {
        logger.error(`call mediaStream error, eMsg: ${e}`)
      }
    }
  }

  _startDrawBack() {
    this._disappear = false
    switch (this._replaceType) {
      case REPLACE_BACKGROUND_TYPE_NONE:
        this._shouldRequestAnimation = false
        this._shouldDrawBack = false
        // 在选择背景过程中，无论是否用绿幕，都按照"我有绿幕"是不选择背景的情况去执行
        this._openDrawColorTimer();
        break
      case REPLACE_BACKGROUND_TYPE_IMAGE:
      case REPLACE_BACKGROUND_TYPE_VIDEO:
        if (this._useGreenScreen === true) {
          // 使用绿幕
          if (this._replaceType === REPLACE_BACKGROUND_TYPE_IMAGE) {
            this._handleImageCanvasCtx.clearRect(0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
            this._handleImageCanvasCtx.drawImage(this._bkImageEle, 0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
            this._imageFrame = this._handleImageCanvasCtx.getImageData(0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          }
          this._shouldRequestAnimation = false
          this._shouldDrawBack = true
          this._openDrawColorTimer();
        } else {
          // 人脸识别
          this._closeDrawColorTimer()
          this._shouldRequestAnimation = true
          this._shouldDrawBack = true;
          this._handleVideo()
        }
        break
      case REPLACE_BACKGROUND_TYPE_BLUR:
        // 人脸识别
        this._closeDrawColorTimer()
        this._shouldRequestAnimation = true
        this._shouldDrawBack = true;
        this._handleVideo()
        break
    }
    this._reCaptureVideoStream()
  }

  _openDrawColorTimer() {
    if (!this._computeInterval) {
      this._computeInterval = setInterval(()=>{
        if (this._replaceType === REPLACE_BACKGROUND_TYPE_VIDEO) {
          // 如果选择的背景是视频就重绘背景
          this._handleImageCanvasCtx.clearRect(0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          this._handleImageCanvasCtx.drawImage(this._bkVideoEle, 0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
          this._imageFrame = this._handleImageCanvasCtx.getImageData(0, 0, this._handleImageCanvas.width, this._handleImageCanvas.height);
        }
        this._handleVideo()
      }, 33)
    }
  }

  _closeDrawColorTimer() {
    if (this._computeInterval) {
      clearInterval(this._computeInterval)
      this._computeInterval = undefined
    }
  }

  _handleVideo() {
    // 使用绿幕和不画背景(非blue)都使用timer来执行
    if (this._replaceType === REPLACE_BACKGROUND_TYPE_NONE || (this._useGreenScreen === true && this._replaceType !== REPLACE_BACKGROUND_TYPE_BLUR)) {
      if (this._originVideo.srcObject) {
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
    } else {
      if (!this._selfieSegmentation) {
        try {
          this._selfieSegmentation = new SelfieSegmentation({ locateFile: (file) => {
              return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`;
            }
          });
          this._selfieSegmentation.setOptions({
            modelSelection: 1,
          });
          this._selfieSegmentation.onResults((results) => {
            if (this._showCanvasCtx) {
              try {
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
                  case REPLACE_BACKGROUND_TYPE_VIDEO:
                    this._showCanvasCtx.drawImage(this._bkVideoEle, 0, 0, this._showCanvas.width, this._showCanvas.height)
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
              } catch (e) {
                logger.warn(`_selfieSegmentation draw error, eMsg: ${e}`)
              }
              // 请求下一帧动画
              this._requestAnimation()
            }
          });
        } catch (e) {
          this._selfieSegmentation = undefined
        }
      }
      if (this._isRequestAnimation === false) {
        this._requestAnimation()
      }
    }
  }

  _requestAnimation() {
    if (this._shouldRequestAnimation === true && this._selfieSegmentation) {
      this._isRequestAnimation = true
      requestAnimationFrame(() => {
        if (this._shouldRequestAnimation === true) {
          if (this._originVideo && this._originVideo.srcObject) {
            this._selfieSegmentation.send({image: this._originVideo}).catch((e) => {
              logger.warn(`send originVideo to selfieSegmentation error, eMsg: ${e}`)
              setTimeout(() => {
                this._requestAnimation()
              }, 100)
            })
          } else {
            // 如果视频源已经不存在，就不描绘，待下一个循环再判断是否描绘
            setTimeout(() => {
              this._requestAnimation()
            }, 5000)
          }
        } else {
          this._isRequestAnimation = false
        }
      })
    } else {
      this._isRequestAnimation = false
    }
  }

  _resetShouldDrawBack() {
    window.removeEventListener("click", this._windowOnClick)
    this._shouldDrawBack = true
  }

  _updateColor({offsetX, offsetY}) {

    let rCount = 0
    let gCount = 0
    let bCount = 0

    let canvasW = this._showCanvas.width
    let canvasH = this._showCanvas.height
    let canvasSW = parseInt(this._showCanvas.style.width.replace("px", ""))
    let canvasSH = parseInt(this._showCanvas.style.height.replace("px", ""))

    let round = 10
    let offset = round/2
    let x = offsetX * (canvasW/canvasSW) - offset
    let y = offsetY * (canvasH/canvasSH) - offset
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

  _getStreamFrameRate(mediaStream, userDefault) {
    // 暂时先只返回30帧
    return DEFAULT_FRAME_RATE
    if (mediaStream && mediaStream.getVideoTracks() && mediaStream.getVideoTracks().length > 0)
     return mediaStream.getVideoTracks()[0].getSettings().frameRate
    if (userDefault && userDefault === true)
      return DEFAULT_FRAME_RATE
    return undefined
  }

  _getStreamDeviceId(mediaStream) {
    if (mediaStream && mediaStream.getVideoTracks() && mediaStream.getVideoTracks().length > 0)
      return mediaStream.getVideoTracks()[0].getSettings().deviceId
    return undefined
  }

  _getStreamWidth(mediaStream) {
    if (mediaStream && mediaStream.getVideoTracks() && mediaStream.getVideoTracks().length > 0)
      return mediaStream.getVideoTracks()[0].getSettings().width
    return undefined
  }

  _getStreamHeight(mediaStream) {
    if (mediaStream && mediaStream.getVideoTracks() && mediaStream.getVideoTracks().length > 0)
      return mediaStream.getVideoTracks()[0].getSettings().height
    return undefined
  }

  _checkVideoStreamIsAvailable(videoStream) {
    if (videoStream) {
      let videoTracks = videoStream.getVideoTracks()
      if (videoTracks && videoTracks.length > 0) {
        let videoTrack = videoTracks[0]
        return videoTrack.enabled && !videoTrack.muted
      }
    }
    return false
  }

  _closeVideoTracks() {
    try {
      if (this._originVideo.srcObject) {
        for (let videoTrack of this._originVideo.srcObject.getVideoTracks()) {
          videoTrack.stop()
        }
      }
    } catch (e) {}
    this._originVideo.srcObject = undefined;
  }

}