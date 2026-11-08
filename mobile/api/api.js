import axios from "axios";

const API_URL ="http://10.51.4.119:5001/api";

export const api = axios.create({
  baseURL: API_URL,
});

// Attach token automatically
export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
};
