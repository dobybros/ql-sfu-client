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
    if (mediaStream && mediaStream.getVideoTracks() && mediaStream.getVideoTracks().length > 0) {
      // 如果现存的流与原始流deviceId不一样或者帧数不一样就就重新获取流（暂时先只比较deviceId）
      let originDeviceId = this._getStreamDeviceId(mediaStream)
      let originFrameRate = this._getStreamFrameRate(mediaStream, false)
      let originHeight = this._getStreamHeight(mediaStream)
      let curDeviceId = this._getStreamDeviceId(this._originVideo.srcObject)
      let curFrameRate = this._getStreamFrameRate(this._originVideo.srcObject, false)
      let curHeight = this._getStreamHeight(this._originVideo.srcObject)
      // 不需要返回原始流才创建新流
      this._originMediaStream = mediaStream
      if (!this._shouldReturnOriginStream()
        && ((!curDeviceId || curDeviceId !== originDeviceId)
          || (!curFrameRate || curFrameRate !== originFrameRate)
          || (!curHeight || (originHeight < DEFAULT_HEIGHT && originHeight !== curHeight) || (originHeight >= DEFAULT_HEIGHT && DEFAULT_HEIGHT !== curHeight)))) {
        if (originHeight <= DEFAULT_HEIGHT) {
          this._resetTrackAndStartDraw(mediaStream, true)
        }  else {
          let cloneTrack = mediaStream.getVideoTracks()[0].clone()
          let constraints = {
            width : {
              exact: DEFAULT_WIDTH
            },
            height : {
              exact: DEFAULT_HEIGHT
            }
          };
          BeautifyVideoClient._applyConstraintsForTrack(cloneTrack, constraints).then(() => {
            this._resetTrackAndStartDraw(new MediaStream([cloneTrack]), false)
          })
        }
      }
      if (this._shouldReturnOriginStream()) {
        this._shouldReCapture = true
        this._reCaptureVideoStream()
      }
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
    this._disappear = false
    if (!this._checkVideoStreamIsAvailable(this._originVideo.srcObject)) {
      if (this._replaceType === REPLACE_BACKGROUND_TYPE_NONE && this._checkVideoStreamIsAvailable(this._originMediaStream)) {
        // 空白的时候比较特殊，因为用户关闭设置框时，如果没有选择背景，就会把原流回调过去
        this.upsertParams({mediaStream: this._originMediaStream})
      }
    }
  }

  /**
   * 更换背景
   * @param imgSrc 背景图片的src
   */
  replaceBackImg(imgSrc) {
    logger.info(`start replace background image with image ${imgSrc}`);
    if (imgSrc) {
      this._preReplaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
      this._preReplaceId = imgSrc
      if (imgSrc !== this._bkImageEle.src) {
        this._preBkImageEle.onload = () => {
          logger.info(`loaded image ${imgSrc}`);
          if (this._preReplaceType === REPLACE_BACKGROUND_TYPE_IMAGE && this._preReplaceId === imgSrc) {
            this._bkImageEle.src = imgSrc;
            this._replaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
            this._startDrawBack();
          }
        }
        this._preBkImageEle.src = imgSrc
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
      this._preReplaceType = REPLACE_BACKGROUND_TYPE_VIDEO;
      this._preReplaceId = videoSrc
      if (videoSrc !== this._bkVideoEle.src) {
        this._preBkVideoEle.addEventListener("canplaythrough", (event) => {
          logger.info(`canplay video ${videoSrc}`);
          if (this._preReplaceType === REPLACE_BACKGROUND_TYPE_VIDEO && this._preReplaceId === videoSrc) {
            this._bkVideoEle.src = videoSrc;
            this._replaceType = REPLACE_BACKGROUND_TYPE_VIDEO;
            this._startDrawBack();
          }
        })
        this._preBkVideoEle.src = videoSrc;
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
      this._preReplaceType = REPLACE_BACKGROUND_TYPE_BLUR;
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
    this._preReplaceType = REPLACE_BACKGROUND_TYPE_NONE;
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

    // 即将被替换的类型
    this._preReplaceType = REPLACE_BACKGROUND_TYPE_NONE;

    // 即将被替换的id
    this._preReplaceId = undefined;

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

    // 视频当前播放时间（s）
    this._videoCurrentTime = 0

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

    window._originVideo = this._originVideo

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

    // 预加载背景图片的标签
    this._preBkImageEle = document.createElement("img")
    this._preBkImageEle.crossOrigin = "Anonymous";

    // 初始化需要改变的视频
    this._bkVideoEle = document.createElement("video")
    this._bkVideoEle.setAttribute("autoplay", '');
    this._bkVideoEle.setAttribute("playsinline", '');
    this._bkVideoEle.setAttribute("loop", 'loop');
    this._bkVideoEle.crossOrigin = "Anonymous";

    // 预加载视频的element
    this._preBkVideoEle = document.createElement("video")
    this._preBkVideoEle.setAttribute("autoplay", '');
    this._preBkVideoEle.setAttribute("playsinline", '');
    this._preBkVideoEle.crossOrigin = "Anonymous";

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
        if (this._shouldReturnOriginStream()) {
          this._mediaStreamCallBack(this._originMediaStream)
        } else {
          let oldCaptureStream = this._oldCaptureStream
          this._oldCaptureStream = this._showCanvas.captureStream(this._getStreamFrameRate(this._originMediaStream, true))
          this._mediaStreamCallBack(this._oldCaptureStream)
          // this._releaseMediaStream(oldCaptureStream)
        }
      } catch (e) {
        logger.error(`call mediaStream error, eMsg: ${e}`)
      }
    }
  }

  _shouldReturnOriginStream() {
    return (this._replaceType === REPLACE_BACKGROUND_TYPE_NONE && this._disappear === true) || !this._showCanvas
  }

  _startDrawBack() {
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
        if (this._imageFrame) {
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
            // selfieMode: true  是否镜像
          });
          this._selfieSegmentation.onResults((results) => {
            if (this._showCanvasCtx) {
              try {
                this._showCanvasCtx.save();

                // 绘制原图
                this._showCanvasCtx.drawImage(results.image, 0, 0, this._showCanvas.width, this._showCanvas.height);

                // 绘制mask(人体部分)，mask是只有一个人形的画面，destination-atop：重叠部分使用旧画面，旧画面不重叠部分将被清空，新画面不重叠部分将保留
                this._showCanvasCtx.globalCompositeOperation = 'destination-atop';
                this._showCanvasCtx.drawImage(results.segmentationMask, 0, 0, this._showCanvas.width, this._showCanvas.height);

                // 绘制背景，destination-over：重叠部分使用原来的，所以不重叠部分保留
                let background = undefined
                switch (this._replaceType) {
                  case REPLACE_BACKGROUND_TYPE_BLUR:
                    this._showCanvasCtx.filter = `blur(${this._blurradius}px)`
                    background = results.image
                    break
                  case REPLACE_BACKGROUND_TYPE_IMAGE:
                    background = this._bkImageEle
                    break
                  case REPLACE_BACKGROUND_TYPE_VIDEO:
                    background = this._bkVideoEle
                    break
                  default:
                    break
                }
                this._showCanvasCtx.globalCompositeOperation = 'destination-over';
                this._showCanvasCtx.drawImage(background, 0, 0, this._showCanvas.width, this._showCanvas.height)

                this._showCanvasCtx.restore();

              } catch (e) {
                logger.warn(`_selfieSegmentation draw error, eMsg: ${e}`)
              }
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
            let duration = this._originVideo.currentTime - this._videoCurrentTime
            if (0 <= duration && duration < 0.03) {
              this._requestAnimation()
            } else {
              this._videoCurrentTime = this._originVideo.currentTime
              this._selfieSegmentation.send({image: this._originVideo}).then(() => {
                this._requestAnimation()
              }).catch((e) => {
                logger.warn(`send originVideo to selfieSegmentation error, eMsg: ${e}`)
                this._isRequestAnimation = false
              })
            }
          } else {
            // 如果视频源已经不存在，就不描绘，待下一个循环再判断是否描绘
            // setTimeout(() => {
            //   this._requestAnimation()
            // }, 5000)
            this._isRequestAnimation = false
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
    // return DEFAULT_FRAME_RATE
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

  _resetTrackAndStartDraw(mediaStream, needClone) {
    this._resetTrack(mediaStream, needClone).then(() => {
      // 重新创建流，就开始画，并且回调新流
      this._shouldReCapture = true
      this._startDrawBack()
    })
  }

  _resetTrack(mediaStream, needClone) {
    return new Promise((resolve, reject) => {
      if (mediaStream && mediaStream.getVideoTracks() && mediaStream.getVideoTracks().length > 0) {
        if (!this._originVideo.srcObject) {
          this._originVideo.onloadedmetadata = () => {
            resolve()
          }
          if (needClone === true) {
            this._originVideo.srcObject = new MediaStream([mediaStream.getVideoTracks()[0].clone()])
          } else
            this._originVideo.srcObject = mediaStream
        } else {
          let replaceTrack = mediaStream.getVideoTracks()[0]
          if (needClone === true)
            replaceTrack = replaceTrack.clone()
          this._originVideo.srcObject.addTrack(replaceTrack)
          while (this._originVideo.srcObject.getVideoTracks().length > 1) {
            let removeTrack = this._originVideo.srcObject.getVideoTracks()[0]
            this._originVideo.srcObject.removeTrack(removeTrack)
            removeTrack.stop()
          }
          resolve()
        }
      } else {
        reject()
      }
    })
  }

  _closeVideoTracks() {
    this._releaseMediaStream(this._originVideo.srcObject)
    this._originVideo.srcObject = undefined;
    this._shouldRequestAnimation = false;
  }

  _releaseMediaStream(mediaStream) {
    try {
      if (mediaStream) {
        for (let videoTrack of mediaStream.getVideoTracks()) {
          videoTrack.stop()
        }
      }
    } catch (e) {}
  }

  static _applyConstraintsForTrack(track, constraints) {
    return new Promise((resolve, reject) => {
      if (track && constraints && 'applyConstraints' in track) {
        track.applyConstraints(constraints)
          .then(() => {
            resolve()
          })
          .catch(e => {
            reject(e)
          })
      } else
        reject()
    })
  }

}