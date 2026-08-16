import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import LoginScreen from '@/components/auth/LoginScreen';
import { ThemeProvider } from '@/lib/themeContext';
import { UploadProvider } from '@/lib/uploadContext';
import UploadManager from '@/components/upload/UploadManager';

import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Clients from '@/pages/Clients';
import ClientDetail from '@/pages/ClientDetail';
import ExerciseLibrary from '@/pages/ExerciseLibrary';
import Programs from '@/pages/Programs';
import ProgramDetail from '@/pages/ProgramDetail';
import MealLibrary from '@/pages/MealLibrary';
import DietPlans from '@/pages/DietPlans';
import MyProgram from '@/pages/MyProgram';
import MyDiet from '@/pages/MyDiet';
import Progress from '@/pages/Progress';
import CalendarPage from '@/pages/CalendarPage';
import Notifications from '@/pages/Notifications';
import AdminNotifications from '@/pages/AdminNotifications';
import FitnessTools from '@/pages/FitnessTools';
import ClientVideos from '@/pages/ClientVideos';
import AccessRequests from '@/pages/AccessRequests';
import InvitedClientDetail from '@/pages/InvitedClientDetail';
import SubscriptionSimulator from '@/pages/SubscriptionSimulator';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      return <LoginScreen />;
    }
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/invited/:id" element={<InvitedClientDetail />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/exercises" element={<ExerciseLibrary />} />
        <Route path="/programs" element={<Programs />} />
        <Route path="/programs/:id" element={<ProgramDetail />} />
        <Route path="/meals" element={<MealLibrary />} />
        <Route path="/diet-plans" element={<DietPlans />} />
        <Route path="/my-program" element={<MyProgram />} />
        <Route path="/my-diet" element={<MyDiet />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/admin-notifications" element={<AdminNotifications />} />
        <Route path="/tools" element={<FitnessTools />} />
        <Route path="/videos" element={<ClientVideos />} />
        <Route path="/access-requests" element={<AccessRequests />} />
        <Route path="/simulator" element={<SubscriptionSimulator />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <ThemeProvider>
          <UploadProvider>
            <Router>
              <AuthenticatedApp />
            </Router>
            <UploadManager />
            <Toaster />
          </UploadProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
