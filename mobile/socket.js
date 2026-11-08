import { io } from "socket.io-client";

const SOCKET_URL = "http://localhost:5001"; // Your backend URL
export const socket = io(SOCKET_URL, {
  autoConnect: false, // connect manually after login
});
