import type { Socket } from 'socket.io-client';
import { ServerToClientEvents, ClientToServerEvents, VoiceChatUser } from '../types'; // 確保 VoiceChatUser 被引入
import { NotificationType } from '../components/NotificationToast'; // 引入 NotificationType

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // 你可以加入更多的 STUN/TURN 伺服器
];

const PEER_CONNECTION_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
};

class WebRTCManager {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private localStream: MediaStream | null;
  private roomId: string;
  private localPlayerId: number;
  private peerConnections: Record<string, RTCPeerConnection> = {};
  private peerPlayerInfo: Record<string, { playerName: string, playerId: number, isMuted: boolean }> = {}; // 儲存 peer 的附加資訊
  private addNotification: (message: string, type: NotificationType, duration?: number) => void;

  public onRemoteStreamAdded: ((socketId: string, stream: MediaStream) => void) | null = null;
  public onRemoteStreamRemoved: ((socketId: string) => void) | null = null;
  public onPlayerSpeaking: ((socketId: string, speaking: boolean) => void) | null = null;
  public onPlayerMuted: ((socketId: string, muted: boolean) => void) | null = null; // 新增回調

  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private speakingIntervalId: number | null = null;
  private isCurrentlySpeaking: boolean = false;


  constructor(
    socket: Socket<ServerToClientEvents, ClientToServerEvents>,
    localStream: MediaStream | null,
    roomId: string,
    localPlayerId: number,
    addNotification: (message: string, type: NotificationType, duration?: number) => void
  ) {
    this.socket = socket;
    this.localStream = localStream;
    this.roomId = roomId;
    this.localPlayerId = localPlayerId;
    this.addNotification = addNotification;

    if (this.localStream) {
      this.initSpeakingDetection();
    }
  }

  private initSpeakingDetection() {
    if (!this.localStream || this.localStream.getAudioTracks().length === 0) return;

    try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 256; // 可以調整
        this.analyserNode.smoothingTimeConstant = 0.5; // 可以調整

        const source = this.audioContext.createMediaStreamSource(this.localStream);
        source.connect(this.analyserNode);
        
        this.dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

        this.speakingIntervalId = window.setInterval(this.checkSpeaking, 200); // 每 200ms 檢查一次
    } catch (error) {
        console.error("[WebRTCManager] 初始化語音偵測失敗:", error);
        this.audioContext = null;
        this.analyserNode = null;
        this.dataArray = null;
    }
  }

  private checkSpeaking = () => {
    if (!this.analyserNode || !this.dataArray) return;

    this.analyserNode.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const average = sum / this.dataArray.length;

    // 調整閾值以適應不同的麥克風靈敏度和背景噪音
    const speakingThreshold = 15; // 可以調整此值
    const currentlySpeaking = average > speakingThreshold;

    if (currentlySpeaking !== this.isCurrentlySpeaking) {
      this.isCurrentlySpeaking = currentlySpeaking;
      if (this.onPlayerSpeaking) {
        this.onPlayerSpeaking(this.socket.id, this.isCurrentlySpeaking); // 通知本地 UI
      }
      this.socket.emit('voiceChatSpeakingUpdate', { speaking: this.isCurrentlySpeaking });
    }
  };

  public connectToExistingPeers(users: VoiceChatUser[]) {
    console.log(`[WebRTCManager] 連接到房間 ${this.roomId} 中已存在的語音使用者:`, users);
    users.forEach(user => {
      if (user.socketId !== this.socket.id) {
        this.createPeerConnection(user.socketId, user.playerName, user.playerId, user.isMuted, true);
      }
    });
  }

  public connectToNewPeer(peerSocketId: string, peerName: string, peerPlayerId: number, peerIsMuted: boolean) {
    if (peerSocketId === this.socket.id || this.peerConnections[peerSocketId]) {
      return;
    }
    console.log(`[WebRTCManager] 連接到新加入的語音使用者 ${peerName} (Socket ID: ${peerSocketId})`);
    this.createPeerConnection(peerSocketId, peerName, peerPlayerId, peerIsMuted, false);
  }

  private createPeerConnection(peerSocketId: string, peerName: string, peerPlayerId: number, peerIsMuted: boolean, isInitiator: boolean) {
    if (this.peerConnections[peerSocketId]) {
        console.warn(`[WebRTCManager] 與 ${peerSocketId} 的連接已存在，忽略重複創建。`);
        return;
    }
    console.log(`[WebRTCManager] 創建與 ${peerName} (SocketID: ${peerSocketId}, PlayerID: ${peerPlayerId}) 的 PeerConnection。起始者: ${isInitiator}`);
    this.peerPlayerInfo[peerSocketId] = { playerName: peerName, playerId: peerPlayerId, isMuted: peerIsMuted };

    const pc = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
    this.peerConnections[peerSocketId] = pc;

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    } else {
        console.warn(`[WebRTCManager] 本地音訊流不存在，無法為與 ${peerSocketId} 的連接添加軌道。`);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('voiceSignal', {
          toSocketId: peerSocketId,
          signal: { candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTCManager] 收到來自 ${peerSocketId} 的遠端軌道。Streams:`, event.streams);
      if (event.streams && event.streams[0]) {
        if (this.onRemoteStreamAdded) {
          this.onRemoteStreamAdded(peerSocketId, event.streams[0]);
        }
      } else {
         // 有些瀏覽器可能只觸發 ontrack 而不是 streams[0]
         const inboundStream = new MediaStream();
         inboundStream.addTrack(event.track);
         if (this.onRemoteStreamAdded) {
          this.onRemoteStreamAdded(peerSocketId, inboundStream);
        }
      }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTCManager] 與 ${peerSocketId} 的 ICE 連接狀態改變: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
            this.addNotification(`${this.peerPlayerInfo[peerSocketId]?.playerName || '一位玩家'} 的語音連接已斷開。`, 'warning');
            this.handlePeerDisconnect(peerSocketId);
        }
    };


    if (isInitiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          this.socket.emit('voiceSignal', {
            toSocketId: peerSocketId,
            signal: { sdp: pc.localDescription },
          });
        })
        .catch(e => console.error('[WebRTCManager] 創建 Offer 失敗:', e));
    }
  }

  public handleIncomingSignal(fromSocketId: string, signal: any) {
    const pc = this.peerConnections[fromSocketId];
    if (!pc) {
      // 如果連接不存在，可能是一個新的連接請求 (對方是起始者)
      // 查找該用戶資訊，如果伺服器已廣播過
      const peerInfo = this.peerPlayerInfo[fromSocketId] || {playerName: `玩家 ${fromSocketId.substring(0,4)}`, playerId: -1, isMuted: false };
      this.createPeerConnection(fromSocketId, peerInfo.playerName, peerInfo.playerId, peerInfo.isMuted, false);
      // 重新獲取 pc
      const newPc = this.peerConnections[fromSocketId];
      if(newPc) this.processSignal(newPc, fromSocketId, signal);
      else console.error(`[WebRTCManager] 處理信令時，與 ${fromSocketId} 的連接仍未創建成功。`);
      return;
    }
    this.processSignal(pc, fromSocketId, signal);
  }

  private processSignal(pc: RTCPeerConnection, fromSocketId: string, signal: any) {
    if (signal.sdp) {
      pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
        .then(() => {
          if (signal.sdp.type === 'offer') {
            return pc.createAnswer()
              .then(answer => pc.setLocalDescription(answer))
              .then(() => {
                this.socket.emit('voiceSignal', {
                  toSocketId: fromSocketId,
                  signal: { sdp: pc.localDescription },
                });
              });
          }
        })
        .catch(e => console.error('[WebRTCManager] 處理 SDP 信令失敗:', e));
    } else if (signal.candidate) {
      pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
        .catch(e => console.error('[WebRTCManager] 添加 ICE Candidate 失敗:', e));
    }
  }
  
  public toggleMute(muted: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
      console.log(`[WebRTCManager] 本地麥克風已 ${muted ? '靜音' : '取消靜音'}`);
      // 通知其他客戶端此靜音狀態 (透過 App.tsx 中的 socket.emit)
    }
  }

  public handlePeerDisconnect(socketId: string) {
    const pc = this.peerConnections[socketId];
    if (pc) {
      pc.close();
      delete this.peerConnections[socketId];
      delete this.peerPlayerInfo[socketId];
      if (this.onRemoteStreamRemoved) {
        this.onRemoteStreamRemoved(socketId);
      }
      console.log(`[WebRTCManager] 與 ${socketId} 的連接已關閉。`);
    }
  }

  public closeAllConnections() {
    if (this.speakingIntervalId) {
        window.clearInterval(this.speakingIntervalId);
        this.speakingIntervalId = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(e => console.warn("[WebRTCManager] 關閉 AudioContext 時發生錯誤:", e));
        this.audioContext = null;
    }
    this.analyserNode = null;
    this.dataArray = null;
    
    Object.keys(this.peerConnections).forEach(socketId => {
      this.handlePeerDisconnect(socketId);
    });
    this.peerConnections = {};
    this.peerPlayerInfo = {};
    console.log('[WebRTCManager] 所有 WebRTC 連接已關閉。');
  }
}

export default WebRTCManager;
