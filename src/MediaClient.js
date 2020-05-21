import * as mediasoupClient from 'mediasoup-client'
import IMClient from 'ql-im-client'
import {uuid} from './utils/UUID'
import SoundMeter from './utils/stream/SoundMeter'
import {log, tablizeString} from './utils/logger'

const logger = log('ql-sfu-client', 'MediaClient');

const SERVICE = 'gwsfusignal';

// peer status
const PEER_STATUS_INIT = 1;
const PEER_STATUS_CONNECTING = 2;
const PEER_STATUS_CONNECTED = 3;

// transport status
const TRANSPORT_STATUS_INIT = 100;
const TRANSPORT_STATUS_NEW = 101;
const TRANSPORT_STATUS_CONNECTING = 102;
const TRANSPORT_STATUS_CONNECTED = 103;
const TRANSPORT_STATUS_DISCONNECTED = 104;
const TRANSPORT_STATUS_FAILED = 105;
const TRANSPORT_STATUS_CLOSED = 106;
const TRANSPORT_STATUS_ACTIVE_CLOSE = 107;
const TRANSPORT_STATUS_RETRY_CLOSE = 108;

// result error code
const RESULT_ERROR_CODE_CANNOT_FIND_TRANSPORT = 2011;

export default class MediaClient {
  constructor() {
  }

  /********************* public method **********************/

  /**
   * 初始化mediaClient
   * @param roomId 必传，房间id
   * @param userId 必传，用户id
   * @param terminal 必传，verify返回的terminal
   * @param imLoginUrl 必传，登录im的url
   * @param auth 必传，classToken
   * @param turns 需要用的turns
   * @param audioFrequency audioMeter的频率(ms)，默认200ms
   * @param audioContext 获取音量所使用
   * @param audioMeterCallback 获取音量的回调
   * @param newReceiverCallback 必传，有新的可以接收的流时回调客户端，客户端收到回调如果确定自己要接收此路流，就创建一个video标签，并调用接口receiveMedia把video标签传过来，开始接收此流
   * @param receiverClosedCallback 必传，某路接收流关闭时的回调
   */
  init({roomId, userId, terminal, imLoginUrl, auth, turns, audioFrequency, audioContext, audioMeterCallback, newReceiverCallback, receiverClosedCallback}) {
    logger.info(`user will init mediaClient, roomId : ${roomId}, userId : ${userId}, terminal : ${terminal}, imLoginUrl : ${imLoginUrl}, 
    audioFrequency : ${audioFrequency}, audioContext : ${audioContext}, audioMeterCallback : ${audioMeterCallback}, 
    newReceiverCallback : ${newReceiverCallback}, receiverClosedCallback : ${receiverClosedCallback}`);

    if (roomId && userId && terminal && imLoginUrl && auth && newReceiverCallback && receiverClosedCallback) {
      // 清除数据
      this._close();

      // 初始化数据
      this._initData();

      // 打印statistics
      this._initPeerStatsLog();

      this._account = roomId;
      this._userId = userId;
      this._terminal = terminal;
      this._imLoginUrl = imLoginUrl;
      this._auth = auth;
      this._newReceiverCallback = newReceiverCallback;
      this._receiverClosedCallback = receiverClosedCallback;
      this._turns = turns ? turns : [];
      this._audioFrequancy = audioFrequency;
      this._audioContext = audioContext;
      this._audioMeterCallback = audioMeterCallback;
      this._connectIM();
    } else {
      logger.info(`user init mediaClient error, param error.`);
    }
  }

  /**
   * 发送一路流，如果调用此方法之前，已经有该peerId对应的流在发送，将会先释放旧的流，再创建新的
   * @param peerId 必传，这路流的id
   * @param trackMap 必传并不能为空，发送的track信息
   * @param bandwidth 此路流需要的带宽，使用verify中返回的值
   * @param resultCallback 调用此方法是否成功
   * @param recvInfo 此路视频接收信息，传null保持不变，若此参数不为null，并且参数中的recvTerminals为null，则发给所有人
   * {
   *   recvTerminals : [1, 3455]
   * }
   */
  sendMedia(peerId, trackMap, bandwidth, resultCallback, recvInfo) {
    logger.info("send media, peerId : " + peerId + ", trackMap : " + trackMap + ", bandwidth : " + bandwidth + ", recvTerminals : " + recvInfo);
    if (peerId) {
      // 创建peer
      let peer = this._peerMap.get(peerId);
      if (peer) {
        this._releasePeer(peerId, null, true);
      }
      peer = this._createPeer(peerId, true);
      if (recvInfo) {
        peer.recvTerminals = recvInfo.recvTerminals;
      }
      peer.bandwidth = bandwidth;
      if (trackMap && trackMap.size > 0) {
        for (let trackId of trackMap.keys()) {
          peer.trackMap.set(trackId, trackMap.get(trackId))
        }
      }
      // 发送流
      this._sendPeer(peerId);
      if (resultCallback) {
        resultCallback(true)
      }
    } else {
      logger.error("send media failed, param error, peerId : " + peerId);
      if (resultCallback) {
        resultCallback(false, "param error.");
      }
    }
  }

  /**
   * 添加或更新一个track
   * @param peerId 必传，这路流的id
   * @param trackId 必传，要添加或更新的trackId，对应sendMedia方法中trackMap中的key
   * @param newTrack 要添加或更新的track
   * @param newBandwidth 更新该track需要的带宽，不传则保持原来带宽不变
   * @param resultCallback 调用此方法是否成功
   * @param recvInfo 此路视频接收信息，传null保持不变，若此参数不为null，并且参数中的recvTerminals为null，则发给所有人
   *  {
   *    recvTerminals : [1, 3455]
   *  }
   */
  async upsertTrack(peerId, trackId, newTrack, newBandwidth, resultCallback, recvInfo) {
    logger.info("upsert track, peerId : " + peerId + ", trackId : " + trackId + ", newTrack : " + newTrack + ", newBandwidth : " + newBandwidth + ", recvInfo : " + recvInfo);
    if (peerId && trackId && newTrack) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        // 释放旧的producer
        peer.trackMap.delete(trackId);
        if (peer.producerMap.get(trackId)) {
          this._releaseProducer(peerId, trackId, null, true);
        }
        // 更新transport参数
        let updateTransport = false;
        if (newBandwidth && newBandwidth !== peer.bandwidth) {
          peer.bandwidth = newBandwidth;
          updateTransport = true;
        }
        if (recvInfo) {
          peer.recvTerminals = recvInfo.recvTerminals;
          updateTransport = true;
        }
        if (updateTransport === true) {
          this._sendUpdateTransport(peerId, newBandwidth, recvInfo)
        }
        // 创建新的producer
        peer.trackMap.set(trackId, newTrack);
        await this._produceTrack(peerId, trackId);
        if (resultCallback) {
          resultCallback(true)
        }
      } else {
        logger.info("upsert track error, can not find peer, peerId : " + peerId + ", trackId : " + trackId);
        if (resultCallback) {
          resultCallback(false, "can not find peer.");
        }
      }
    } else {
      logger.info("upsert track error, param error, peerId : " + peerId + ", trackId : " + trackId);
      if (resultCallback) {
        resultCallback(false, "param error.");
      }
    }
  }

  /**
   * 暂停音频或视频，调用该方法将暂停播放所有的音频或视频
   * @param peerId 必传，这路流的id
   * @param kind 必传，"audio"或"video"
   * @param resultCallback 调用此方法是否成功
   */
  pause(peerId, kind, resultCallback) {
    logger.info("peer : " + peerId + ", pause " + kind);
    if (peerId && kind) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        peer[kind + "Pause"] = true;
        if (peer.isProducer === true) {
          for (let trackId of peer.producerMap.keys()) {
            let producer = peer.producerMap.get(trackId);
            if (producer.kind === kind)
              producer.pause();
          }
        } else {
          for (let trackId of peer.consumerMap.keys()) {
            let consumer = peer.consumerMap.get(trackId);
            if (consumer.kind === kind)
              consumer.pause();
          }
        }
      }
      if (resultCallback) {
        resultCallback(true);
      }
    } else {
      if (resultCallback) {
        resultCallback(false, "param error.");
      }
    }
  }

  /**
   * 是否为暂停状态
   * @param peerId
   * @param kind "audio" or "video"
   * @return boolean
   */
  isPaused(peerId, kind) {
    if (peerId && kind) {
      let peer = this._peerMap.get(peerId);
      if (!peer) {
        return false;
      } else {
        return peer[kind + "Pause"];
      }
    } else {
      return false;
    }
  }

  /**
   * 继续播放音频或视频，调用该方法将继续播放所有的音频或视频
   * @param peerId 必传，这路流的id
   * @param kind 必传，"audio"或"video"
   * @param resultCallback 调用此方法是否成功
   */
  resume(peerId, kind, resultCallback) {
    logger.info("peer : " + peerId + ", resume " + kind);
    if (peerId && kind) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        peer[kind + "Pause"] = false;
        if (peer.isProducer === true) {
          for (let trackId of peer.producerMap.keys()) {
            let producer = peer.producerMap.get(trackId);
            if (producer.kind === kind)
              producer.resume();
          }
        } else {
          for (let trackId of peer.consumerMap.keys()) {
            let consumer = peer.consumerMap.get(trackId);
            if (consumer.kind === kind)
              consumer.resume();
          }
        }
      }
      if (resultCallback) {
        resultCallback(true);
      }
    } else {
      if (resultCallback) {
        resultCallback(false, "param error.");
      }
    }
  }

  /**
   * 关闭某一个track
   * @param peerId 必传，这路流的id
   * @param trackId 必传，要关闭的trackId，对应sendMedia方法中trackMap中的key
   */
  closeTrack(peerId, trackId) {
    logger.info("peer : " + peerId + " will close track : " + trackId);
    if (peerId && trackId) {
      let peer = this._peerMap.get(peerId);
      if (peer && peer.isProducer === true) {
        let track = peer.trackMap.get(trackId);
        if (track) {
          peer[`connecting${track.kind}trackId`] = undefined;
          peer[`using${track.kind}trackId`] = undefined;
        }
        peer.trackMap.delete(trackId);
        if (peer.producerMap.get(trackId)) {
          this._releaseProducer(peerId, trackId, null, true);
        }
      }
    }
  }

  /**
   * 关闭某路流
   * @param peerId 必传，这路流的id
   */
  closeMedia(peerId) {
    logger.info("peer : " + peerId + " will close");
    if (peerId) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        this._sendTransportStatusChangedMsg(peerId, peer.transport ? peer.transport.id : null, TRANSPORT_STATUS_ACTIVE_CLOSE);
        this._releasePeer(peerId, null, true);
      }
    }
  }

  /**
   * 开始接收某路流
   * @param peerId 必传，这路流的id
   * @param audioElement 需要接受此路流的audio标签，之后此audio标签的srcObject由mediaClient来控制
   * @param videoElement 需要接受此路流的video标签，之后此video标签的srcObject由mediaClient来控制
   */
  receiveMedia(peerId, audioElement, videoElement) {
    logger.info("user will receive media : " + peerId);
    if (peerId && (audioElement || videoElement)) {
      let peer = this._peerMap.get(peerId);
      if (peer && peer.status === PEER_STATUS_INIT && !peer.audioElement && !peer.videoElement) {
        if (audioElement) {
          this._setElementParam(audioElement, "audio");
          peer.audioElement = audioElement;
        }
        if (videoElement) {
          this._setElementParam(videoElement, "video");
          peer.videoElement = videoElement;
        }
        this._getRouterRtpCapability(peerId);
      } else {
        logger.error(`receive media error, peerId : ${peerId}, peer not exist or peer's element exist.`)
      }
    }
  }

  /**
   * 添加或更新element
   * @param peerId 必传，element所属路流的id
   * @param kind 必传，"audio"或"video"
   * @param element 要添加或更新的element
   */
  upsertElement(peerId, kind, element) {
    logger.info("user will upsert element, peer : " + peerId + ", kind : " + kind + ", element : " + element);
    if (peerId && kind && element) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        let oldElement = peer[kind + "Element"];
        if (oldElement) {
          oldElement.srcObject = null
        }
        let tracks = [];
        for (let producerId of peer.consumerMap.keys()) {
          let consumer = peer.consumerMap.get(producerId);
          if (consumer.kind === kind) {
            tracks.push(consumer.track);
          }
        }
        this._setElementParam(element, kind);
        element.srcObject = new MediaStream(tracks);
        peer[kind + "Element"] = element;
        /*let playPromise = element.play();
        if (playPromise) {
          playPromise.then(() => {
            logger.info("peer " + peerId + ", kind " + kind + " play success");
          }).catch((e) => {
            logger.info("peer " + peerId + ", kind " + kind + " play error, eMsg: " + e);
          });
        }*/
      }
    }
  }

  /**
   * 删除element
   * @param peerId 必传，element所属路流的id
   * @param kind 必传，"audio"或"video"
   */
  deleteElement(peerId, kind) {
    logger.info("user will delete element, peer : " + peerId + ", kind : " + kind);
    if (peerId && kind) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        let oldElement = peer[kind + "Element"];
        if (oldElement) {
          oldElement.srcObject = null;
          peer[kind + "Element"] = null;
        }
      }
    }
  }

  /**
   * 判断media是否已建联
   * @param peerId
   * @return boolean
   */
  isMediaConnected(peerId) {
    if (peerId) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        if (peer.status && (peer.status === PEER_STATUS_CONNECTING || peer.status === PEER_STATUS_CONNECTED)) {
          return true
        }
      }
    }
    return false
  }

  /**
   * 关闭mediaClient
   */
  close() {
    logger.info("user " + this._userId + " will close media client.");
    this._close();
  }

  _close() {
    if (this._imClient) {
      try {
        this._imClient.close();
      } catch (e) {}
    }
    this._imClient = null;
    if (this._peerMap && this._peerMap.size > 0) {
      for (let peerId of this._peerMap.keys()) {
        try {
          this._releasePeer(peerId, null, true);
        } catch (e) {}
      }
    }
    window._peerMap = null;
    if (this._callbackMap) {
      this._callbackMap.clear();
    }
    if (this._soundMeterMap && this._soundMeterMap.size > 0) {
      for (let peerId of this._soundMeterMap.keys()) {
        try {
          this._closeAudioMeter(peerId);
        } catch (e) {}
      }
      this._soundMeterMap.clear();
    }
    this._clearPeerStatsLog();
  }

  _initData() {
    this._peerMap = new Map();
    window._peerMap = this._peerMap;
    this._callbackMap = new Map();
    this._soundMeterMap = new Map();
    this._joind = false;
    this._connect = false;
  }

  _createPeer(peerId, isProducer) {
    let peer = this._peerMap.get(peerId);
    if (!peer) {
      peer = {
        peerId : peerId,
        isProducer : isProducer,
        status : PEER_STATUS_INIT,
        transportStatus : TRANSPORT_STATUS_INIT,
        audioPause : false,
        videoPause : false,
        bandwidth : null,
        producerMap : new Map(),
        consumerMap : new Map(),
        trackMap : new Map()
      };
      this._peerMap.set(peerId, peer);
    }
    return peer
  }

  _sendPeer(peerId) {
    if (this._connect === true) {
      let peer = this._peerMap.get(peerId);
      if (peer && peer.isProducer === true && peer.status === PEER_STATUS_INIT) {
        this._getRouterRtpCapability(peerId);
      }
    }
  }

  _getRouterRtpCapability(peerId) {
    let peer = this._peerMap.get(peerId);
    if (peer && peer.status === PEER_STATUS_INIT) {
      peer.status = PEER_STATUS_CONNECTING;
      try {
        peer.device = new mediasoupClient.Device();
      } catch (e) {
        logger.error("peer" + peerId + " create device error, eMsg: " + e);
        return;
      }
      this._sendGetRouterRtpCapabilityMsg(peerId, null);
    }
  }

  async _loadDevice(peerId, routerRtpCapabilities) {
    let peer = this._peerMap.get(peerId);
    if (peer) {
      let device = peer.device;
      try {
        await device.load({routerRtpCapabilities})
      } catch (e) {
        logger.error("peer" + peerId + " load device error, eMsg: " + e);
        throw e;
      }
    }
  }

  async _createTransport(peerId, id, iceParameters, iceCandidates, dtlsParameters, sctpParameters) {
    let peer = this._peerMap.get(peerId);
    peer.transportId = id;
    if (peer.isProducer) {
      let sendTransport;
      try {
        sendTransport = peer.device.createSendTransport({
          id : id,
          iceCandidates : iceCandidates,
          iceParameters : iceParameters,
          dtlsParameters : dtlsParameters,
          sctpParameters : sctpParameters,
          iceServers : this._turns
        });
      } catch (e) {
        logger.error("peer" + peerId + " create ms send transport error, eMsg: " + e);
        throw e;
      }
      peer.transport = sendTransport;
      sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        peer.status = PEER_STATUS_CONNECTED;
        try {
          this._sendConnectTransportMsg(peerId, dtlsParameters, (result) => {
            if (result && result.data && result.data.code && result.data.code === RESULT_ERROR_CODE_CANNOT_FIND_TRANSPORT) {
              let peer = this._peerMap.get(peerId);
              if (peer) {
                this._releasePeer(peerId, null, peer.isProducer === false);
              }
            }
          });
          callback();
        } catch (e) {
          errback(e);
        }
      });
      sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          let producePeerId = appData.peerId;
          logger.info(`peer ${producePeerId} kind ${kind} on produced`);
          let producePeer = this._peerMap.get(producePeerId);
          if (producePeer) {
            let shouldReleaseProducer = false;
            let shouldReProduce = false;
            let produceTrackId = undefined;
            let allUsingTrackId = producePeer[`using${kind}trackId`];
            let connectingTrackId = producePeer[`connecting${kind}trackId`];
            if (allUsingTrackId && connectingTrackId) {
              let arr = allUsingTrackId.split("&&");
              let usingTrackId = arr[0];
              if (connectingTrackId === usingTrackId) {
                this._sendProduceMsg(producePeerId, connectingTrackId + kind, kind, rtpParameters, {trackInfo : appData.trackInfo});
                this._callbackMap.set(connectingTrackId, callback);
              } else {
                logger.warn(`peer ${producePeerId} produce error, connecting trackId ${connectingTrackId} is not using trackId ${usingTrackId}`);
                shouldReleaseProducer = true;
                shouldReProduce = true;
                produceTrackId = arr[1];
              }
            } else {
              logger.warn(`peer ${producePeerId} produce error, using trackId or connecting trackId is null, using ${allUsingTrackId}, connectingTrackId ${connectingTrackId}`);
              shouldReleaseProducer = true;
            }
            if (shouldReleaseProducer === true) {
              callback({id : appData.trackId});
              producePeer[`connecting${kind}trackId`] = undefined;
              this._releaseProducer(producePeerId, null, appData.trackId, false);
            }
            if (shouldReProduce) {
              this._produceTrack(producePeerId, produceTrackId)
            }
          } else {
            errback(new Error(`peer ${producePeerId} is null when on produce ${kind}.`));
          }
        } catch (error) {
          errback(error);
        }
      });
      sendTransport.on('connectionstatechange', (connectionState) => {
        logger.info("sender " + peerId + " connection state change to " + connectionState);
        this._handleTransportStatus(peerId, sendTransport.id, connectionState);
      });
      await this._createProducers(peerId);
    } else {
      let recvTransport;
      try {
        recvTransport= peer.device.createRecvTransport({
          id : id,
          iceParameters : iceParameters,
          iceCandidates : iceCandidates,
          dtlsParameters : dtlsParameters,
          sctpParameters : sctpParameters,
          iceServers : this._turns
        });
      } catch (e) {
        logger.error("peer" + peerId + " create ms send transport error, eMsg: " + e);
        throw e;
      }
      peer.transport = recvTransport;
      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        try {
          this._sendConnectTransportMsg(peerId, dtlsParameters, (result) => {
            if (result && result.data && result.data.code && result.data.code === RESULT_ERROR_CODE_CANNOT_FIND_TRANSPORT) {
              let peer = this._peerMap.get(peerId);
              if (peer) {
                this._releasePeer(peerId, null, peer.isProducer === false);
              }
            }
          });
          callback();
        } catch (e) {
          errback(e);
        }
      });
      recvTransport.on('connectionstatechange', (connectionState) => {
        logger.info("receiver " + peerId + " connection state change to " + connectionState);
        this._handleTransportStatus(peerId, recvTransport.id, connectionState);
      });
    }
  }

  _handleTransportStatus(peerId, transportId, connectionState) {
    let peer = this._peerMap.get(peerId);
    switch (connectionState) {
      case "new":
        peer.transportStatus = TRANSPORT_STATUS_NEW;
        break;
      case "connecting":
        peer.transportStatus = TRANSPORT_STATUS_CONNECTING;
        break;
      case "connected":
        if (peer) {
          peer.transportStatus = TRANSPORT_STATUS_CONNECTED;
          this._sendTransportStatusChangedMsg(peerId, transportId, peer.transportStatus, null);
          this._releaseReconnectInfo(peerId);
        }
        break;
      case "disconnected":
        peer.transportStatus = TRANSPORT_STATUS_DISCONNECTED;
        this._sendTransportStatusChangedMsg(peerId, transportId, peer.transportStatus, null);
        if (peer) {
          peer.disconnecteTime = new Date().getTime();
          peer.reconnectTimer = setTimeout(() => {
            peer.reconnectTimer = null;
            let now = new Date().getTime();
            if (peer.transportStatus === TRANSPORT_STATUS_DISCONNECTED
              && peer.status !== PEER_STATUS_INIT
              && peer.disconnecteTime && (now - peer.disconnecteTime >= 3000)) {
              this._releasePeer(peerId, null, false);
              // 重连
              this._getRouterRtpCapability(peerId);
            }
          }, 3000);
        }
        break;
      case "failed":
      case "closed":
        if (connectionState === "failed")
          peer.transportStatus = TRANSPORT_STATUS_FAILED;
        else if (connectionState === "closed")
          peer.transportStatus = TRANSPORT_STATUS_CLOSED;
        if (peer) {
          this._releaseReconnectInfo(peerId);
          this._sendTransportStatusChangedMsg(peerId, transportId, peer.transportStatus, (result) => {
            if (peer.status !== PEER_STATUS_INIT &&
              (peer.isProducer === true ||
                (result && result.data && result.data.content && result.data.content.senderIsConnected && result.data.content.senderIsConnected === true))) {
              this._releasePeer(peerId, transportId, false);
              // 重连
              this._getRouterRtpCapability(peerId);
            }});
        }
        break;
      default:
        break
    }
  }

  async _createProducers(peerId) {
    let peer = this._peerMap.get(peerId);
    if (peer && peer.trackMap.size > 0) {
      for (let trackId of peer.trackMap.keys()) {
        await this._produceTrack(peerId, trackId)
      }
    }
  }

  async _produceTrack(peerId, trackId) {
    let peer = this._peerMap.get(peerId);
    if (peer && peer.transport && peer.device) {
      let track = peer.trackMap.get(trackId);
      if (track) {
        if (peer.device.canProduce(track.kind)) {
          let cloneTrack = track.clone();
          let options = {
            track : cloneTrack,
            appData : {
              peerId : peerId,
              trackId : cloneTrack.id,
              trackInfo : {
                originId : track.id,
                label : cloneTrack.label,
                enabled : cloneTrack.enabled,
                muted : cloneTrack.muted,
                readyState : cloneTrack.readyState
              }
            }
          };
          if (track.kind === "audio") {
            options["codecOptions"] = {
              opusStereo : 1,
              opusDtx    : 1
            }
          }
          peer[`using${track.kind}trackId`] = `${cloneTrack.id}&&${trackId}`;
          logger.info(`peer ${peerId} ${track.kind} set usingTrackId ${cloneTrack.id}&&${trackId}`);
          if (!peer[`connecting${track.kind}trackId`]) {
            peer[`connecting${track.kind}trackId`] = cloneTrack.id;
            logger.info(`peer ${peerId} ${track.kind} set connectingTrackId ${cloneTrack.id}`);
            let producer;
            try {
              producer = await peer.transport.produce(options);
              if (peer[`using${track.kind}trackId`] && producer.track.id === peer[`using${track.kind}trackId`].split("&&")[0]) {
                let oldProducer = peer.producerMap.get(trackId);
                if (oldProducer) {
                  logger.warn(`peer ${peerId} producer ${producer.id} creat sucess, but old producer ${oldProducer.id} exist, so release old.`);
                  this._releaseProducer(peerId, null, oldProducer.id, true);
                }
                peer.producerMap.set(trackId, producer);
                logger.info(`peer ${peerId} track ${trackId} producerTrackId ${producer.track.id} producerId : ${producer.id}`);
                producer.on('transportclose', () => {
                });
                producer.on('trackended', () => {
                  logger.warn(`peer ${peerId} track ${trackId} ${track ? track.label : ""} ended.`);
                });
                if (peer[track.kind + "Pause"] === true) {
                  producer.pause();
                }
                if (track.kind === "audio") {
                  this._upsertAudioMeter(peerId, track.clone())
                }
              } else {
                try {
                  producer.close();
                } catch (e) {}
              }
            } catch (e) {
              peer[`connecting${track.kind}trackId`] = undefined;
              logger.error("peer " + peerId + " create " + track.kind +  " producer error, eMsg: " + e);
            }
          }
        }
      }
    }
  }

  async _createConsumer(peerId, producerId, id, kind, rtpParameters, type, producerPaused) {
    let peer = this._peerMap.get(peerId);
    let options = {
      id : id,
      producerId : producerId,
      kind : kind,
      rtpParameters : rtpParameters
    };
    if (kind === "audio") {
      options["opusStereo"] = 1
    }
    let consumer;
    try {
      consumer = await peer.transport.consume(options);
    } catch (e) {
      logger.error("peer " + peerId + " create consumer error, eMsg: " + e);
      throw e;
    }
    peer.consumerMap.set(producerId, consumer);
    if (peer[kind + "Pause"] === true) {
      consumer.pause();
    }
    let element = peer[kind + "Element"];
    if (element) {
      logger.info("will set consumer track, peer " + peerId + ", kind " + kind);
      element.srcObject = new MediaStream([consumer.track]);
      if (kind === "video") {
        this._releasePeerCheckVideoSrcTimer(peerId);
        peer.checkVideoSrcTimer = setTimeout(() => {
          if (element && element.srcObject) {
            try {
              let quality = element.getVideoPlaybackQuality();
              if (quality) {
                let dropped = quality.droppedVideoFrames;
                let total = quality.totalVideoFrames;
                if (total > 0) {
                  if (dropped/total > 0.8) {
                    logger.info("will reset consumer srcObject, peer " + peerId + ", kind " + kind);
                    element.srcObject = element.srcObject;
                  } else {
                    this._releasePeerCheckVideoSrcTimer(peerId);
                  }
                }
              } else {
                this._releasePeerCheckVideoSrcTimer(peerId);
              }
            } catch (e) {
              this._releasePeerCheckVideoSrcTimer(peerId);
            }
          } else {
            this._releasePeerCheckVideoSrcTimer(peerId);
          }
        }, 1000);
      }
      /*let playPromise = element.play();
      if (playPromise) {
        playPromise.then(() => {
          logger.info("peer " + peerId + ", kind " + kind + " play success");
        }).catch((e) => {
          logger.info("peer " + peerId + ", kind " + kind + " play error, eMsg: " + e);
        });
      }*/
    }
    if (kind === "audio") {
      this._upsertAudioMeter(peerId, consumer.track);
    }
  }

  _releasePeer(peerId, transportId, deletePeer) {
    let peer = this._peerMap.get(peerId);
    if (peer && (!transportId || (peer.transport && transportId === peer.transport.id))) {
      if (deletePeer && deletePeer === true) {
        this._peerMap.delete(peerId);
        peer.trackMap.clear();
      }
      peer.status = PEER_STATUS_INIT;
      this._releaseReconnectInfo(peerId);
      this._releasePeerCheckVideoSrcTimer(peerId);
      peer.device = null;
      if (peer.transport) {
        try {
          peer.transport.close();
        } catch (e) {}
      }
      peer.transport = null;
      if (peer.isProducer === true) {
        if (peer.producerMap.size > 0) {
          for (let trackId of peer.producerMap.keys()) {
            let producer = peer.producerMap.get(trackId);
            if (producer.track) {
              let producerTrackId = producer.track.id;
              if (producerTrackId) {
                let connectingTrackId = peer[`connecting${producer.kind}trackId`];
                if (connectingTrackId && connectingTrackId === producerTrackId) {
                  peer[`connecting${producer.kind}trackId`] = undefined;
                }
              }
            }
            try {
              producer.close();
            } catch (e) {}

          }
          peer.producerMap.clear()
        }
      } else {
        if (peer.consumerMap.size > 0) {
          for (let producerId of peer.consumerMap.keys()) {
            let consumer = peer.consumerMap.get(producerId);
            try {
              consumer.close();
            } catch (e) {}
          }
          peer.consumerMap.clear()
        }
      }
      if (peer.audioElement && deletePeer && deletePeer === true) {
        peer.audioElement.srcObject = null;
        peer.audioElement = null;
      }
      if (peer.videoElement && deletePeer && deletePeer === true) {
        peer.videoElement.srcObject = null;
        peer.videoElement = null;
      }
      this._closeAudioMeter(peerId);
      if (peer.isProducer === false && deletePeer && deletePeer === true && this._receiverClosedCallback)
        this._receiverClosedCallback(peerId);
    }
  }

  _releasePeerCheckVideoSrcTimer(peerId) {
    let peer = this._peerMap.get(peerId);
    if (peer && peer.checkVideoSrcTimer) {
      clearTimeout(peer.checkVideoSrcTimer);
      peer.checkVideoSrcTimer = undefined;
    }
  }

  _releaseReconnectInfo(peerId) {
    if (peerId) {
      let peer = this._peerMap.get(peerId);
      if (peer) {
        peer.transportStatus = TRANSPORT_STATUS_INIT;
        peer.disconnecteTime = null;
        if (peer.reconnectTimer) {
          clearTimeout(peer.reconnectTimer);
          peer.reconnectTimer = null;
        }
      }
    }
  }

  _releaseProducer(peerId, trackId, producerId, sendCloseToServer) {
    let peer = this._peerMap.get(peerId);
    if (peer) {
      let producer = undefined;
      if (producerId) {
        if (peer.producerMap.size > 0) {
          for (let key of peer.producerMap.keys()) {
            if (peer.producerMap.get(key).id === producerId) {
              producer = peer.producerMap.get(key);
              if (!trackId) {
                trackId = key;
              }
              break;
            }
          }
        }
      }
      if (!producer && trackId) {
        producer = peer.producerMap.get(trackId);
      }
      if (producer) {
        producerId = producer.id;
        if (producer.track) {
          let producerTrackId = producer.track.id;
          if (producerTrackId) {
            let connectingTrackId = peer[`connecting${producer.kind}trackId`];
            if (connectingTrackId && connectingTrackId === producerTrackId) {
              peer[`connecting${producer.kind}trackId`] = undefined;
            }
          }
        }
        try {
          producer.close();
        } catch (e) {}
        if (producer.kind === "audio") {
          this._closeAudioMeter(peerId);
        }
        peer.producerMap.delete(trackId);
      }
      if (sendCloseToServer && sendCloseToServer === true && producerId) {
        this._sendChangeProducerMsg(peerId, producerId, 1);
      }
    }
  }

  _releaseConsumer(peerId, producerId) {
    let peer = this._peerMap.get(peerId);
    if (peer) {
      let consumer = peer.consumerMap.get(producerId);
      peer.consumerMap.delete(producerId);
      if (consumer) {
        let element = peer[consumer.kind + "Element"];
        if (element && element.srcObject) {
          element.srcObject.removeTrack(consumer.track);
        }
        try {
          consumer.close()
        } catch (e) {}
        if (consumer.kind === "audio") {
          this._closeAudioMeter(peerId);
        }
      } else {
        logger.warn(`will release peer ${peerId} consumer ${producerId}, but consumer not exist.`);
      }
    }
  }

  _releaseCallback(callback, error) {
    if (callback) {
      if (error) {
        callback.errback(error);
      }
      callback.callback = undefined;
      callback.errback = undefined;
    }
  }

  _upsertAudioMeter(peerId, audioTrack) {
    try {
      if (this._audioContext && this._audioMeterCallback && peerId && audioTrack) {
        let soundMeter = this._soundMeterMap.get(peerId);
        this._soundMeterMap.delete(peerId);
        if (soundMeter) {
          try {
            soundMeter.stop();
          } catch (e) {}
        }
        soundMeter = new SoundMeter(this._audioContext, new MediaStream([audioTrack]), (n) => {
          this._audioMeterCallback(peerId, Math.round(1000 * n));
        });
        this._soundMeterMap.set(peerId, soundMeter);
      }
    } catch (e) {
      logger.error(`create audio meter for ${peerId} error, eMsg: ${e}.`)
    }
  }

  _setElementParam(element, kind) {
    if (element) {
      element.setAttribute("autoplay", '');
      element.setAttribute("playsinline", '');
      if (kind === "video") {
        element.muted = true;
      }
    }
  }

  _closeAudioMeter(peerId) {
    if (peerId) {
      let soundMeter = this._soundMeterMap.get(peerId);
      this._soundMeterMap.delete(peerId);
      if (soundMeter) {
        try {
          soundMeter.stop();
        } catch (e) {}
      }
    }
  }

  async _connectIM() {
    this._imClient = new IMClient({
      account: this._account,
      service: SERVICE,
      auth: this._auth,
      terminal: this._terminal,
      imLoginUrl: this._imLoginUrl
    });
    this._imClient.start();
    this._imClient.setEventListener((event, message) => {
      logger.info("received event : " + event + ", message : " + JSON.stringify(message));
      switch (event) {
        case ".message":
          this._handleMessage(message);
          break;
        case ".result":
          break;
        case ".status":
          this._handleStatus(message);
          break;
        default:
          break;
      }
    });
  }

  _handleStatus(message) {
    switch (message) {
      case "connected":
        logger.info("im connected, will send join");
        this._sendJoinMsg(this._userId, (result) => {
          logger.info("join result : " + result.data);
          this._connect = true;
          for (let peerId of this._peerMap.keys()) {
            this._sendPeer(peerId);
          }
        });
        break;
      case "disconnected":
        logger.info("im disconnected, will release peer");
        this._connect = false;
        for (let peerId of this._peerMap.keys()) {
          let peer = this._peerMap.get(peerId);
          this._releasePeer(peerId, null, !peer.isProducer);
        }
        break;
      default:
        break
    }
  }

  async _handleMessage(message) {
    const {contentType, content} = message;
    switch (contentType) {
      case "canReceiveTran" : {
        const {peerIds, init} = content;
        if (init)
          this._joind= true;
        if (this._joind === true) {
          peerIds.forEach((peerId) => {
            logger.info("can receive peerId : " + peerId);
            let peer = this._peerMap.get(peerId);
            if (!peer || peer.status === PEER_STATUS_INIT) {
              this._createPeer(peerId, false);
              if (this._newReceiverCallback)
                this._newReceiverCallback(peerId);
            }
          });
        }
      }
        break;
      case "recrrcpb" : {
        const {peerId, bilities, code, eMsg} = content;
        let needReconnect = false;
        if (code) {
          needReconnect = true;
        } else {
          try {
            await this._loadDevice(peerId, bilities);
            this._sendCreateTransportMsg(peerId, (result) => {
              if (result && result.data && result.data.code && result.data.code === RESULT_ERROR_CODE_CANNOT_FIND_TRANSPORT) {
                let peer = this._peerMap.get(peerId);
                if (peer) {
                  this._releasePeer(peerId, null, peer.isProducer === false);
                }
              }
            });
          } catch (e) {
            needReconnect = true;
          }
        }
        if (needReconnect === true) {
          let peer = this._peerMap.get(peerId);
          if (peer) {
            if (peer.transport) {
              this._sendTransportStatusChangedMsg(peerId, peer.transport.id, TRANSPORT_STATUS_RETRY_CLOSE);
            }
            this._releasePeer(peerId, null, false);
            setTimeout(() => {
              this._getRouterRtpCapability(peerId);
            }, 1000);
          }
        }
      }
        break;
      case "credTran" : {
        const {peerId, id, iceParameters, iceCandidates, dtlsParameters, sctpParameters} = content;
        await this._createTransport(peerId, id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, this._turns);
      }
        break;
      case "credProducer" : {
        const {peerId, producerId, producerClientId} = content;
        if (peerId && producerId && producerClientId) {
          const length = producerClientId.length;
          let kind = producerClientId.substring(length - 5);
          let trackId = producerClientId.substr(0, length - 5);
          let callback = this._callbackMap.get(trackId);
          let error = undefined;
          let shouldReProduce = false;
          let produceTrackId = undefined;
          this._callbackMap.delete(trackId);
          let peer = this._peerMap.get(peerId);
          if (peer && callback) {
            let allUsingTrackId = peer[`using${kind}trackId`];
            if (allUsingTrackId) {
              let arr = allUsingTrackId.split("&&");
              let usingTrackId = arr[0];
              if (usingTrackId !== trackId) {
                produceTrackId = arr[1];
                shouldReProduce = true;
                error = new Error(`param error, using trackId ${usingTrackId} producerClientId ${trackId}`);
              }
            } else {
              error = new Error(`param error, using trackId is null`);
            }
          } else {
            error = new Error("peer is null or callback is null");
          }
          if (callback) {
            callback({id : producerId});
          }
          if (error) {
            logger.error(`peer ${peerId} create ${kind} producer error, eMsg : ${error}`);
            this._releaseProducer(peerId, null, producerId, true);
          }
          if (peer) {
            let connectingTrackId = peer[`connecting${kind}trackId`];
            if (connectingTrackId && connectingTrackId === trackId) {
              logger.info(`will release connecting track, peer ${peerId} ${kind} connectingTrackId ${connectingTrackId}`);
              peer[`connecting${kind}trackId`] = undefined;
            } else {
              logger.warn(`can not release connecting trackId when created producer, because peer ${peerId} ${kind} connecting trackId ${connectingTrackId}`);
            }
          }
          if (shouldReProduce === true) {
            this._produceTrack(peerId, produceTrackId);
          }
        }
      }
        break;
      case "newConsume" : {
        const {peerId, producerId, id, kind, rtpParameters, type, producerPaused} = content;
        await this._createConsumer(peerId, producerId, id, kind, rtpParameters, type, producerPaused);
      }
        break;
      case "tClose" : {
        const {peerId, transportId, reason} = content;
        let needReconnected = false;
        if (reason >= 3000 && reason <= 3500) {
          needReconnected = true;
        }
        if (needReconnected === false) {
          let peer = this._peerMap.get(peerId);
          if (peer && peer.isProducer === true)
            needReconnected = true;
        }
        this._releasePeer(peerId, transportId, !needReconnected);
        if (needReconnected === true)
          this._getRouterRtpCapability(peerId);
      }
        break;
      case "pState" : {
        const {peerId, producerId, state} = content;
        if (producerId && state === 1) {
          this._releaseProducer(peerId, null, producerId, false);
        }
      }
        break;
      case "cState" : {
        const {peerId, producerId, state} = content;
        if (state === 1) {
          this._releaseConsumer(peerId, producerId)
        }
      }
        break;
      default:
        break
    }
  }

  /****************** send message to im ******************/

  _sendJoinMsg(peerId, resultCallback) {
    this._sendMessage("join", {
      peerId : peerId
    }, resultCallback);
  }

  _sendGetRouterRtpCapabilityMsg(peerId, resultCallback) {
    let peer = this._peerMap.get(peerId);
    if (peer) {
      let content = {peerId : peerId, isProduce : peer.isProducer};
      if (peer.isProducer === true && peer.recvTerminals)
        content["recvTerminals"] = peer.recvTerminals;
      this._sendMessage('getrrcpb', content, resultCallback)
    }
  }

  _sendCreateTransportMsg(peerId, resultCallback) {
    let peer = this._peerMap.get(peerId);
    if (peer) {
      this._sendMessage("createtran", {
        peerId : peerId,
        forceTcp : false,
        isProduce : peer.isProducer,
        rtpCapabilities : peer.device.rtpCapabilities,
        maxIncomingBitrate : peer.bandwidth
      }, resultCallback);
    } else {
      logger.warn(`peer ${peerId} want send create transport message, but peer not exist.`)
    }
  }

  _sendConnectTransportMsg(peerId, dtlsParameters, resultCallback) {
    let peer = this._peerMap.get(peerId);
    if (peer) {
      this._sendMessage("contran", {
        peerId : peerId,
        isProduce : peer.isProducer,
        dtlsParameters : dtlsParameters}, resultCallback);
    } else {
      logger.warn(`peer ${peerId} want send connect transport message, but peer not exist.`)
    }
  }

  _sendProduceMsg(peerId, producerClientId, kind, rtpParameters, reserve) {
    let peer = this._peerMap.get(peerId);
    if (peer) {
      this._sendMessage("produce", {
        peerId : peerId,
        producerClientId : producerClientId,
        kind : kind,
        rtpParameters : rtpParameters,
        reserve : reserve
      });
    } else {
      logger.warn(`peer ${peerId} kind ${kind} want send produce message, but peer not exist.`)
    }
  }

  _sendChangeProducerMsg(peerId, producerId, state, resultCallback) {
    this._sendMessage("changePro", {
      peerId : peerId,
      producerId : producerId,
      state : state
    }, resultCallback);
  }

  _sendUpdateTransport(peerId, bandwidth, recvInfo, resultCallback) {
    let content = {peerId : peerId};
    if (bandwidth)
      content.maxIncomingBitrate = bandwidth;
    if (recvInfo)
      content.recvInfo = recvInfo;
    this._sendMessage("upTrans", content, resultCallback);
  }

  _sendTransportStatusChangedMsg(peerId, transportId, status, resultCallback) {
    this._sendMessage("tranStatusChanged", {
      peerId : peerId,
      transportId : transportId,
      status : status
    }, resultCallback);
  }

  _sendMessage(contentType, content, resultCallback) {
    this._imClient.send({
      id : uuid(),
      type : 16,
      service : SERVICE,
      contentType : contentType,
      contentEncode : 2,
      content : content
    }, resultCallback)
  }

  _initPeerStatsLog() {
    // 打印statistics
    this._lastStats = {};
    window.__need_media_stats_log = false;
    window.__switch_media_stats = function () {
      window.__need_media_stats_log = !window.__need_media_stats_log;
    };
    window.__ks = {audio: {}, video: {}};
    window.__media_stats_collect_intervel = window.setInterval(this._collectStats.bind(this), 1500);
  }

  async _collectStats() {
    const lengthArg = [3, 1, 7, 25, 10];
    if (window.__need_media_stats_log === true) {
      logger.debug(tablizeString(lengthArg,
        '***',
        'T',
        'kind',
        'peerId',
        '∆ bytes',
        '∆ pkt',
        'pkt Lost',
        '∆ frame',
        'keyFrame',
        '∆ decodeTime'
      ));
      for (let peerId of this._peerMap.keys()) {
        const peer = this._peerMap.get(peerId);
        if (!peer) continue;
        let statsMap = new Map();
        if (peer.isProducer === true) {
          if (peer.producerMap.size > 0) {
            for (let producerId of peer.producerMap.keys()) {
              let producer = peer.producerMap.get(producerId);
              try {
                statsMap.set(producer.kind, await producer.getStats());
              } catch (e) {
                logger.error(`get ${peerId} ${producer.kind} error, eMsg: ${e}`);
              }
            }
          }
        } else {
          if (peer.consumerMap.size > 0) {
            for (let producerId of peer.consumerMap.keys()) {
              let consumer = peer.consumerMap.get(producerId);
              try {
                statsMap.set(consumer.kind, await consumer.getStats());
              } catch (e) {
                logger.error(`get ${peerId} ${consumer.kind} error, eMsg: ${e}`);
              }
            }
          }
        }
        for (let kind of statsMap.keys()) {
          try {
            if (!this._lastStats[peerId]) {
              this._lastStats[peerId] = {}
            }
            const stats = statsMap.get(kind);
            const it = stats.keys();
            let now = it.next();
            while (!now.done) {
              window.__ks[kind][now.value] = true;
              let isUp;
              let k;
              if (peer.isProducer === true) {
                k = 'rtcoutbound';
                isUp = true
              }
              if (peer.isProducer === false) {
                k = 'rtcinbound';
                isUp = false
              }
              if (now.value.toLowerCase().indexOf(k) !== -1) {
                let info = stats.get(now.value);
                const getDeltaWithKey = (ifo, k) => {
                  const last = this._lastStats[peerId][kind] || {};
                  return ifo[k] - (last[k] || 0)
                };
                if (kind === 'audio') {
                  if (isUp) {
                    window.__need_media_stats_log && logger.debug(tablizeString(lengthArg,
                      '***', '↑', kind, peerId,
                      getDeltaWithKey(info, 'bytesSent'),
                      getDeltaWithKey(info, 'packetsSent'),
                      0,
                      0,
                      0,
                      0,
                    ))
                  } else {
                    window.__need_media_stats_log && logger.debug(tablizeString(lengthArg,
                      '***', '↓', kind, peerId,
                      getDeltaWithKey(info, 'bytesReceived'),
                      getDeltaWithKey(info, 'packetsReceived'),
                      info.packetsLost,
                      0,
                      0,
                      info.jitter,
                    ));
                  }
                }
                if (kind === 'video') {
                  if (isUp) {
                    window.__need_media_stats_log && logger.debug(tablizeString(lengthArg,
                      '***', '↑', kind, peerId,
                      getDeltaWithKey(info, 'bytesSent'),
                      getDeltaWithKey(info, 'packetsSent'),
                      0,
                      getDeltaWithKey(info, 'framesEncoded'),
                      info.keyFramesEncoded,
                      getDeltaWithKey(info, 'totalEncodeTime'),
                    ))
                  } else {
                    window.__need_media_stats_log && logger.debug(tablizeString(lengthArg,
                      '***', '↓', kind, peerId,
                      getDeltaWithKey(info, 'bytesReceived'),
                      getDeltaWithKey(info, 'packetsReceived'),
                      info.packetsLost,
                      getDeltaWithKey(info, 'framesDecoded'),
                      info.keyFramesDecoded,
                      getDeltaWithKey(info, 'totalDecodeTime'),
                    ));
                  }
                }
                this._lastStats[peerId][kind] = info
              }
              now = it.next()
            }
          } catch (e) {
            logger.warn('parse stat has exception', e)
          }
        }
      }
    }
  }

  _clearPeerStatsLog() {
    try {
      if (window.__media_stats_collect_intervel)
        window.clearInterval(window.__media_stats_collect_intervel);
    } catch (e) {}
    window.__media_stats_collect_intervel = null;
    window.__ks = null;
    this._lastStats = null;
  }

}
