import type React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './state';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Forgot, Join, Login, Reset, Setup } from './pages/Auth';
import { Feed, Home } from './pages/Home';
import { ForumPage, Forums, NewThread } from './pages/Forums';
import { ThreadPage } from './pages/Thread';
import { GamePage, Games, Predictions, TimeMachine } from './pages/Games';
import { ChatArchive, ChatRoomPage, ChatRooms } from './pages/Chat';
import { Bookmarks, Conversation, Drafts, MemberPage, Members, Messages, Notifications, SearchPage, Settings, UserRedirect } from './pages/Members';
import { Calendar, Contributions, EventPage, MapPage, YearInReview } from './pages/Community';
import { Admin } from './pages/Admin';

function Private({ children, rail = true }: { children: React.ReactElement; rail?: boolean }) {
  const { me, loading } = useApp();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Layout rail={rail}>{children}</Layout>;
}

export function App() {
  const { me, loading } = useApp();
  if (loading) return <Loading />;
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/join/:token" element={<Join />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset/:token" element={<Reset />} />
      <Route path="/" element={<Private><Home /></Private>} />
      <Route path="/feed" element={<Private><Feed /></Private>} />
      <Route path="/forums" element={<Private><Forums /></Private>} />
      <Route path="/f/:slug" element={<Private><ForumPage /></Private>} />
      <Route path="/new" element={<Private><NewThread /></Private>} />
      <Route path="/t/:id" element={<Private><ThreadPage /></Private>} />
      <Route path="/games" element={<Private><Games /></Private>} />
      <Route path="/games/:id" element={<Private><GamePage /></Private>} />
      <Route path="/predictions" element={<Private><Predictions /></Private>} />
      <Route path="/time-machine" element={<Private><TimeMachine /></Private>} />
      <Route path="/chat" element={<Private><ChatRooms /></Private>} />
      <Route path="/chat/:room" element={<Private rail={false}><ChatRoomPage /></Private>} />
      <Route path="/chat/:room/archive" element={<Private><ChatArchive /></Private>} />
      <Route path="/members" element={<Private><Members /></Private>} />
      <Route path="/members/:id" element={<Private><MemberPage /></Private>} />
      <Route path="/u/:username" element={<Private><UserRedirect /></Private>} />
      <Route path="/settings" element={<Private><Settings /></Private>} />
      <Route path="/messages" element={<Private><Messages /></Private>} />
      <Route path="/messages/:userId" element={<Private rail={false}><Conversation /></Private>} />
      <Route path="/notifications" element={<Private><Notifications /></Private>} />
      <Route path="/search" element={<Private><SearchPage /></Private>} />
      <Route path="/bookmarks" element={<Private><Bookmarks /></Private>} />
      <Route path="/drafts" element={<Private><Drafts /></Private>} />
      <Route path="/calendar" element={<Private><Calendar /></Private>} />
      <Route path="/events/:id" element={<Private><EventPage /></Private>} />
      <Route path="/year-in-review" element={<Private><YearInReview /></Private>} />
      <Route path="/contributions" element={<Private><Contributions /></Private>} />
      <Route path="/map" element={<Private><MapPage /></Private>} />
      <Route path="/admin/*" element={<Private rail={false}><Admin /></Private>} />
      <Route path="*" element={<Private><div className="empty">Page not found.</div></Private>} />
    </Routes>
  );
}
