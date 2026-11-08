import { useEffect, useState } from "react";
import { api } from "../api/api";
import { socket } from "../socket";

export default function Dashboard() {
  const [queues, setQueues] = useState([]);
  const [position, setPosition] = useState(null);

  useEffect(() => {
    const fetchQueues = async () => {
      const res = await api.get("/queues");
      setQueues(res.data);
    };
    fetchQueues();
  }, []);

  const joinQueue = async (queueId) => {
    try {
      const res = await api.post(`/queues/${queueId}/join`);
      alert("Joined queue!");
      // Connect to Socket.io room
      socket.connect();
      socket.emit("joinQueueRoom", queueId);

      // Listen for live updates
      socket.on("queueUpdated", (updatedQueue) => {
        const index = updatedQueue.users.findIndex(
          (u) => u.user === localStorage.getItem("userId")
        );
        setPosition(index + 1);
      });
    } catch (err) {
      alert(err.response?.data?.message || "Error joining queue");
    }
  };

  return (
    <div>
      <h2>Available Queues</h2>
      <ul>
        {queues.map((q) => (
          <li key={q._id}>
            {q.name} — {q.users.length} users
            <button onClick={() => joinQueue(q._id)}>Join</button>
          </li>
        ))}
      </ul>
      {position && <p>Your current position: {position}</p>}
    </div>
  );
}
