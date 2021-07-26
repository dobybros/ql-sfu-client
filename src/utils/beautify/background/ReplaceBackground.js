import {SelfieSegmentation} from "@mediapipe/selfie_segmentation";
import {Camera} from "@mediapipe/camera_utils";
import {log} from '../../logger'

const logger = log('ql-sfu-client', 'ReplaceBackground');

const REPLACE_BACKGROUND_TYPE_BLUR = 1
const REPLACE_BACKGROUND_TYPE_IMAGE = 2

export default class ReplaceBackground {

  /**
   * 构造函数
   * @param mediaStreamCallback 视频流更换时的回调
   */
  constructor({mediaStreamCallback}) {
    this._mediaStreamCallback = mediaStreamCallback

    // 初始化原始视频
    this._originVideo = document.createElement("VIDEO");
    this._originVideo.autoplay = true;
    this._originVideo.setAttribute("width", '320');
    this._originVideo.setAttribute("height", '180');

    // 初始化需要改变的背景图
    this._bkImageEle = document.createElement("img")
    this._bkImageEle.crossOrigin = "Anonymous";

    // 需要展示结果的canvas
    this._showCanvas = undefined
    this._showCanvasCtx = undefined

    // 初始化类型
    this._replaceType = REPLACE_BACKGROUND_TYPE_BLUR;
    this._blurradius = 15;
    this._frameRate = 30;

    // 是否应该变背景
    this._shouldDraw = false
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
   * 开始模糊
   * @param radius 模糊半径
   */
  startBlur(radius) {
    logger.info(`start blur with radius ${radius}`)
    if (radius) {
      this._replaceType = REPLACE_BACKGROUND_TYPE_BLUR;
      this._blurradius = radius
      this._handleVideo()
    }
  }

  /**
   * 开始更换背景
   * @param imgUrl 替换北京的图片，不传则是清空背景
   */
  startDrawBackgroundImage(imgUrl) {
    logger.info(`start change background with image ${imgUrl}`)
    if (imgUrl) {
      this._bkImageEle.src = imgUrl;
      this._bkImageEle.onload = () => {
        this._replaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
        this._shouldDraw = true;
        this._handleVideo()
      }
    } else {
      this._replaceType = REPLACE_BACKGROUND_TYPE_IMAGE;
      this._shouldDraw = false;
      this._handleVideo()
    }
  }

  /**
   * 停止绘制canvas，如果没有背景图了，并把原流给客户端
   * @param force 是否强制停止
   */
  stop(force) {
    logger.info(`stop replace background, force ${force}`)
    if ((this._replaceType === REPLACE_BACKGROUND_TYPE_IMAGE && this._shouldDraw === false) || force === true) {
      // todo 不停止camera会怎样？
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
    this._selfieSegmentation.close();
    this._selfieSegmentation = undefined;
    this._camera = undefined;
    this._showCanvasCtx = undefined;
    this._showCanvas = undefined;
    this._originVideo = undefined;
    this._bkImageEle = undefined;
  }

  _handleVideo() {
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
            if (this._shouldDraw === true) {
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
          if (this._selfieSegmentation)
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
  }

}