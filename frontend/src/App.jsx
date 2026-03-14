import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { cn } from "./lib/utils";
import {
  PlayCircle,
  LayoutDashboard,
  Video,
  Radio,
  ListOrdered,
  ScrollText,
  Settings2,
} from "lucide-react";
import { useQueueWebSocket } from "./context/QueueWebSocketContext";
import { ToastProvider } from "./context/ToastContext";
import { UserProvider, useUser } from "./context/UserContext";
import { HeaderUserMenu } from "./components/HeaderUserMenu";
import Watch from "./pages/Watch";
import Dashboard from "./pages/Dashboard";
import Channels from "./pages/Channels";
import Videos from "./pages/Videos";
import Queue from "./pages/Queue";
import Log from "./pages/Log";
import Admin from "./pages/Admin";

function Nav() {
  const linkClass = ({ isActive }) =>
    cn(
      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
      isActive
        ? "bg-gray-800 text-white"
        : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
    );

  return (
    <nav className="flex gap-1 p-2">
      <NavLink to="/watch" className={linkClass}>
        <PlayCircle className="w-4 h-4" />
        Watch
      </NavLink>
      <NavLink to="/" end className={linkClass}>
        <LayoutDashboard className="w-4 h-4" />
        Dashboard
      </NavLink>
      <NavLink to="/channels" className={linkClass}>
        <Radio className="w-4 h-4" />
        Channels
      </NavLink>
      <NavLink to="/videos" className={linkClass}>
        <Video className="w-4 h-4" />
        Videos
      </NavLink>
      <NavLink to="/queue" className={linkClass}>
        <ListOrdered className="w-4 h-4" />
        Queue
      </NavLink>
      <NavLink to="/log" className={linkClass}>
        <ScrollText className="w-4 h-4" />
        Log
      </NavLink>
      <NavLink to="/admin" className={linkClass}>
        <Settings2 className="w-4 h-4" />
        Admin
      </NavLink>
    </nav>
  );
}

/** Inner layout that has access to UserContext; keys main content so it remounts on user switch or reconnect. */
function AppLayout() {
  const [error, setError] = useState(null);
  const { status, reconnectedAt, multipleInstances } = useQueueWebSocket();
  const { currentUser } = useUser();
  const connectionLost = status === "closed";

  useEffect(() => {
    if (reconnectedAt > 0) {
      setError(null);
    }
  }, [reconnectedAt]);

  const isConnectionError = connectionLost || (error && /failed to fetch|network error/i.test(error));
  const displayMessage = isConnectionError ? "Connection to server lost" : error;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col overflow-x-hidden">
      <header className="border-b border-gray-800 bg-gray-900/80 sticky top-0 z-10">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-white shrink-0">FlagShip YouTube</h1>
          <div className="flex items-center gap-2">
            <Nav />
            <HeaderUserMenu />
          </div>
        </div>
        {displayMessage && (
          <div className="px-4 py-2 bg-red-900/30 text-red-300 text-sm flex items-center justify-between">
            <span>{displayMessage}</span>
            {!isConnectionError && (
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-200"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
        {multipleInstances && (
          <div className="px-4 py-2 bg-red-900/30 text-red-300 text-sm">
            More than one backend is running. Please stop duplicate instances.
          </div>
        )}
      </header>
      <main className="flex-1 p-4 min-w-0" key={`${reconnectedAt}-${currentUser?.user_id ?? 0}`}>
        <Routes>
          <Route path="/watch" element={<Watch setError={setError} />} />
          <Route path="/" element={<Dashboard setError={setError} />} />
          <Route path="/channels" element={<Channels setError={setError} />} />
          <Route path="/videos" element={<Videos setError={setError} />} />
          <Route path="/queue" element={<Queue setError={setError} />} />
          <Route path="/log" element={<Log setError={setError} />} />
          <Route path="/admin/*" element={<Admin setError={setError} />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <UserProvider>
          <AppLayout />
        </UserProvider>
      </BrowserRouter>
    </ToastProvider>
  );
}
