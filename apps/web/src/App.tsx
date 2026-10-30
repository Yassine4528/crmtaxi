import { AgendaPage } from './agenda/AgendaPage.tsx';
import { LoginScreen } from './auth/LoginScreen.tsx';
import { DialogsProvider } from './components/Dialogs.tsx';
import { PrintProvider } from './print/PrintProvider.tsx';
import { SessionProvider, useAuthState } from './session.tsx';

export function App() {
  const { user, setUser, logout } = useAuthState();
  if (user === undefined) return null;
  if (user === null) return <LoginScreen onLogin={setUser} />;
  return (
    // la clé garantit un écran vierge à chaque session : aucune fenêtre du compte précédent ne survit
    <SessionProvider key={user.id} user={user} logout={logout}>
      <DialogsProvider>
        <PrintProvider>
          <AgendaPage />
        </PrintProvider>
      </DialogsProvider>
    </SessionProvider>
  );
}
