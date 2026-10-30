import type React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './state';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Forgot, Join, Login, Reset, Setup, SignUp, Verify } from './pages/Auth';
import { Feed, Home } from './pages/Home';
import { ForumPage, NewThread } from './pages/Forums';
import { Rosters } from './pages/Rosters';
import { InviteFriends } from './components/Invite';
import { ThreadPage } from './pages/Thread';
import { GamePage, Games, Predictions, TimeMachine } from './pages/Games';
import { ChatArchive, ChatRoomPage, ChatRooms } from './pages/Chat';
import { Bookmarks, Conversation, Drafts, MemberPage, Members, Messages, Notifications, SearchPage, Settings, UserRedirect } from './pages/Members';
import { Calendar, Contributions, EventPage, MapPage, YearInReview } from './pages/Community';
import { Admin } from './pages/Admin';
import { PlayerPage, Recruiting, SharePage } from './pages/Recruiting';

function Private({ children, rail = true, publicOk = false }: { children: React.ReactElement; rail?: boolean; publicOk?: boolean }) {
  const { me, loading, site } = useApp();
  const loc = useLocation();
  if (loading) return <Loading />;
  // Visitors can read these pages when public reading is switched on.
  if (!me && !(publicOk && site.publicRead)) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
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
      <Route path="/join" element={me ? <Navigate to="/" replace /> : <SignUp />} />
      <Route path="/verify/:token" element={<Verify />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset/:token" element={<Reset />} />
      <Route path="/" element={<Private publicOk><Home /></Private>} />
      <Route path="/feed" element={<Private publicOk><Feed /></Private>} />
      <Route path="/forums" element={<Navigate to="/feed" replace />} />
      <Route path="/f/:slug" element={<Private publicOk><ForumPage /></Private>} />
      <Route path="/new" element={<Private><NewThread /></Private>} />
      <Route path="/t/:id" element={<Private publicOk><ThreadPage /></Private>} />
      <Route path="/games" element={<Private publicOk><Games /></Private>} />
      <Route path="/games/:id" element={<Private publicOk><GamePage /></Private>} />
      <Route path="/predictions" element={<Private publicOk><Predictions /></Private>} />
      <Route path="/time-machine" element={<Private publicOk><TimeMachine /></Private>} />
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
      <Route path="/search" element={<Private publicOk><SearchPage /></Private>} />
      <Route path="/bookmarks" element={<Private><Bookmarks /></Private>} />
      <Route path="/drafts" element={<Private><Drafts /></Private>} />
      <Route path="/calendar" element={<Private><Calendar /></Private>} />
      <Route path="/events/:id" element={<Private><EventPage /></Private>} />
      <Route path="/year-in-review" element={<Private><YearInReview /></Private>} />
      <Route path="/contributions" element={<Private><Contributions /></Private>} />
      <Route path="/map" element={<Private><MapPage /></Private>} />
      <Route path="/invite" element={<Private><InviteFriends /></Private>} />
      <Route path="/rosters" element={<Private publicOk><Rosters /></Private>} />
      <Route path="/recruiting" element={<Private publicOk><Recruiting /></Private>} />
      <Route path="/recruiting/:id" element={<Private publicOk><PlayerPage /></Private>} />
      <Route path="/share" element={<Private><SharePage /></Private>} />
      <Route path="/admin/*" element={<Private rail={false}><Admin /></Private>} />
      <Route path="*" element={<Private><div className="empty">Page not found.</div></Private>} />
    </Routes>
  );
}
