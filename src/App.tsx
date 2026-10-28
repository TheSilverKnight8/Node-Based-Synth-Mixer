import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { DialogHost } from './components/dialogs';
import { liveKeyboard } from './lib/keyboard';
import { hasUnsavedChanges, initFolder, useApp } from './lib/store';
import { FolderSetup, Home } from './pages/Home';
import { InstrumentsPage } from './pages/Instruments';
import { ProjectPage } from './pages/Project';

export default function App() {
  useEffect(() => {
    void initFolder();
    liveKeyboard.attach();
    // Saving happens half a second after an edit; warn if the window closes inside that half second.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppShell>
        <Screens />
      </AppShell>
      <DialogHost />
    </BrowserRouter>
  );
}

function Screens() {
  const ready = useApp((s) => s.folder.kind === 'ready');
  // Until the folder is open, every address shows the setup screen, and then the page that was asked for.
  if (!ready) return <FolderSetup />;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/instruments" element={<InstrumentsPage />} />
      <Route path="/instruments/:id" element={<InstrumentsPage />} />
      <Route path="/project/:id" element={<ProjectPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
