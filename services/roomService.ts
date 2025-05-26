
// FIX: Import RoomListData
import { RoomSettings, RoomListData } from '../types';

// This service is largely deprecated in favor of Socket.IO interactions.
// Kept for structure, but functions are no longer the primary way to interact with the "backend".

// Mock database for rooms (no longer authoritative, server handles this)
/*
let mockRoomsDB: Record<string, RoomListData & { password?: string; fillWithAI?: boolean }> = {
  'room1': { id: 'room1', name: '新手練習房', playersCount: 1, maxPlayers: 4, status: '等待中', passwordProtected: false, numberOfRounds: 4, fillWithAI: true },
  'room2': { id: 'room2', name: '高手競技場', playersCount: 3, maxPlayers: 4, status: '遊戲中', passwordProtected: true, password: '123', numberOfRounds: 8, fillWithAI: true },
  'room3': { id: 'room3', name: '輕鬆打牌局', playersCount: 2, maxPlayers: 4, status: '等待中', passwordProtected: false, numberOfRounds: 1, fillWithAI: true },
};
let nextRoomId = 4;
*/

// Simulate API delay
// const FAKE_API_DELAY = 500; // milliseconds

// All functions below would be replaced by emitting/listening to socket events.

export const createRoom_DEPRECATED = (/* settings: Omit<RoomSettings, 'id'> */): Promise<{ success: boolean; roomId?: string; message?: string }> => {
  return new Promise((resolve) => {
    // setTimeout(() => {
      // Server will handle room creation via socket event 'lobbyCreateRoom'
      console.warn("createRoom_DEPRECATED called. Use socket.emit('lobbyCreateRoom', settings) instead.");
      resolve({ success: false, message: 'This function is deprecated. Use Socket.IO.' });
    // }, FAKE_API_DELAY);
  });
};

export const joinRoom_DEPRECATED = (/* roomId: string, password?: string */): Promise<{ success: boolean; message?: string; roomDetails?: Partial<RoomListData & {fillWithAI?: boolean}> }> => {
  return new Promise((resolve) => {
    // setTimeout(() => {
      // Server will handle joining room via socket event 'lobbyJoinRoom'
      console.warn("joinRoom_DEPRECATED called. Use socket.emit('lobbyJoinRoom', { roomId, password }) instead.");
      resolve({ success: false, message: 'This function is deprecated. Use Socket.IO.' });
    // }, FAKE_API_DELAY);
  });
};


export const getLobbyRooms_DEPRECATED = (): Promise<{ success: boolean; rooms: RoomListData[] }> => {
  return new Promise((resolve) => {
    // setTimeout(() => {
      // Server will send room list via socket event 'lobbyRoomList'
      console.warn("getLobbyRooms_DEPRECATED called. Listen to socket event 'lobbyRoomList' instead.");
      resolve({ success: true, rooms: [] }); // Return empty as server provides data
    // }, FAKE_API_DELAY);
  });
};

export const leaveRoom_DEPRECATED = (/* roomId: string, playerId: string */): Promise<{ success: boolean }> => {
    return new Promise((resolve) => {
        // setTimeout(() => {
            // Server handles leaving via socket event 'gameQuitRoom' or 'lobbyLeave'
            console.warn("leaveRoom_DEPRECATED called. Use socket.emit('gameQuitRoom', roomId) or similar instead.");
            resolve({ success: true });
        // }, FAKE_API_DELAY / 2);
    });
};


export const startGameInRoom_DEPRECATED = (/* roomId: string */): Promise<{ success: boolean; message?: string }> => {
  return new Promise((resolve) => {
    // setTimeout(() => {
        // Host client emits 'gameRequestStart'
        console.warn("startGameInRoom_DEPRECATED called. Use socket.emit('gameRequestStart', roomId) instead.");
        resolve({ success: false, message: 'This function is deprecated. Use Socket.IO.' });
    // }, FAKE_API_DELAY);
  });
};

export const postChatMessage_DEPRECATED = (/* roomId: string, message: { sender: string; text: string } */): Promise<{ success: boolean }> => {
  return new Promise((resolve) => {
    // setTimeout(() => {
      // Client emits 'gameSendChatMessage' or 'lobbySendChatMessage'
      console.warn("postChatMessage_DEPRECATED called. Use socket.emit for chat messages instead.");
      resolve({ success: true });
    // }, FAKE_API_DELAY / 3);
  });
};

// Rematch logic will also be handled via socket events.
export const playerVoteForRematch_DEPRECATED = (/* roomId: string, playerId: string, vote: boolean */): Promise<{ success: boolean; allVoted?: boolean; rematchConfirmed?: boolean }> => {
  return new Promise((resolve) => {
    // setTimeout(() => {
      console.warn("playerVoteForRematch_DEPRECATED called. Use socket.emit for rematch logic instead.");
      resolve({ success: false });
    // }, FAKE_API_DELAY / 2);
  });
};
