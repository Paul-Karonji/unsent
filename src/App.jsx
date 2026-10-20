import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { get, set, del, keys } from 'idb-keyval';
import { hashPassword, verifyPassword, getLocalEntries, cacheEntriesLocally, saveEntryOffline, syncPendingEntries, syncPendingDeletions, LOCAL_HASH_KEY, PENDING_SYNC_KEY, CACHED_ENTRIES_KEY, PENDING_DELETIONS_KEY, USER_ID_KEY } from './db';
import { supabase } from './lib/supabase';
import { clickableProps } from './lib/a11y';
import { Calendar, Search, Book, Image as ImageIcon, Mic, MicOff, Lock, Settings, Eye, EyeOff, WifiOff, Download, LogOut } from 'lucide-react';
import AttachmentUploader from './components/AttachmentUploader';
import AttachmentViewer from './components/AttachmentViewer';
import CalendarView from './components/CalendarView';
import SearchPage from './components/SearchPage';
import { useIdleTimer } from 'react-idle-timer';
import './index.css';

const MOODS = ['Reflective', 'Grateful', 'Hopeful', 'Anxious', 'Sad', 'Angry', 'Joyful', 'Lonely'];
const ATTACHMENT_CACHE_PREFIX = 'attachment_blob_';

function App() {
  const [session, setSession] = useState(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [entries, setEntries] = useState([]);
  const [isWriting, setIsWriting] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftFiles, setDraftFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState('list'); // 'list', 'search', 'calendar'
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [isExporting, setIsExporting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [emailJustConfirmed, setEmailJustConfirmed] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [draftMood, setDraftMood] = useState('Reflective');

  // Set right before we trigger a sign-in ourselves, so the auth listener can
  // tell our own logins apart from an email-confirmation link landing.
  const initiatedLoginRef = useRef(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' ';
          }
        }
        if (finalTranscript) {
          setDraftContent((prev) => prev + finalTranscript);
        }
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error("Failed to start speech recognition:", err);
      }
    }
  };

  // Connection listeners
  useEffect(() => {
    get('unsent_autolock_time').then(val => {
      if (val !== undefined) setAutoLockMinutes(val);
    });
  }, []);

  const handleLock = () => {
    setIsUnlocked(false);
  };

  const handleOnIdle = () => {
    if (isUnlocked && autoLockMinutes > 0) {
      handleLock();
    }
  };

  useIdleTimer({
    timeout: autoLockMinutes > 0 ? 1000 * 60 * autoLockMinutes : 1000 * 60 * 60 * 24, // 24 hours if disabled to avoid firing
    onIdle: handleOnIdle,
    debounce: 500,
    disabled: !isUnlocked || autoLockMinutes === 0
  });

  const fetchEntriesOnline = useCallback(async () => {
    const { data, error } = await supabase
      .from('entries')
      .select(`*, entry_attachments(*)`)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Keep entries that were written offline but not synced yet visible
      // instead of letting the server response overwrite them.
      const pending = (await get(PENDING_SYNC_KEY)) || [];
      const serverIds = new Set(data.map(e => e.id));
      setEntries([...pending.filter(e => !serverIds.has(e.id)), ...data]);
      await cacheEntriesLocally(data);
    }
  }, []);

  const runSync = useCallback(async () => {
    await syncPendingDeletions();
    await syncPendingEntries();
    await fetchEntriesOnline();
  }, [fetchEntriesOnline]);

  const loadEntries = useCallback(async () => {
    // `loading` starts as true and only clears here — silent refreshes on
    // save/delete don't flash the spinner.
    const local = await getLocalEntries();
    setEntries(local);
    setLoading(false);

    if (!isOffline) {
      await runSync();
    }
  }, [isOffline, runSync]);

  // Load entries when unlocked (and replay offline deletions when online)
  useEffect(() => {
    if (!session || !isUnlocked) return;
    let cancelled = false;

    getLocalEntries().then(local => {
      if (!cancelled) {
        setEntries(local);
        setLoading(false);
      }
    });

    if (!isOffline) {
      syncPendingDeletions().then(() => {
        if (!cancelled) runSync();
      });
    }

    return () => {
      cancelled = true;
    };
  }, [session, isUnlocked, isOffline, runSync]);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOffline(false);
      if (isUnlocked) {
        await runSync();
      }
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isUnlocked, runSync]);

  // Auth initialization
  useEffect(() => {
    let hasInitialSession = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsUnlocked(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      // A SIGNED_IN we did not initiate ourselves means the user arrived via
      // an email confirmation link. Stay on the home page and show a banner.
      if (event === 'INITIAL_SESSION') hasInitialSession = true;
      if (event === 'SIGNED_IN') {
        if (hasInitialSession && !initiatedLoginRef.current) {
          setEmailJustConfirmed(true);
        }
        initiatedLoginRef.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Remember the account locally so entries can still be written while
  // offline with no live session.
  useEffect(() => {
    if (session?.user) {
      set(USER_ID_KEY, session.user.id);
    }
  }, [session]);

  const handleUnlock = async (e) => {
    e.preventDefault();
    setAuthError('');

    if (isOffline) {
      // Offline Unlock Mode
      const storedHash = await get(LOCAL_HASH_KEY);
      if (!storedHash) {
        setAuthError('No offline credentials found. You must log in online at least once.');
        return;
      }

      const { ok, upgrade } = await verifyPassword(password, storedHash);
      if (ok) {
        // Transparently upgrade old unsalted SHA-256 hashes to PBKDF2
        if (upgrade) await set(LOCAL_HASH_KEY, await hashPassword(password));
        setIsUnlocked(true);
        setPassword('');
      } else {
        setAuthError('Incorrect password.');
      }
    } else {
      // Online Unlock Mode — fast path: if they already have a session and
      // are just locked, verify against the locally stored hash.
      if (isLogin && session) {
        const storedHash = await get(LOCAL_HASH_KEY);
        if (storedHash) {
          const { ok, upgrade } = await verifyPassword(password, storedHash);
          if (ok) {
            if (upgrade) await set(LOCAL_HASH_KEY, await hashPassword(password));
            setIsUnlocked(true);
            setPassword('');
            return;
          }
          // Stored hash is stale (e.g. the password was changed on another
          // device) — fall through to full Supabase auth with the new one.
        }
      }

      if (isLogin) {
        initiatedLoginRef.current = true;
        const loginEmail = email || session?.user?.email;
        if (!loginEmail) {
          initiatedLoginRef.current = false;
          setAuthError('Enter your email address to log in.');
          return;
        }
        const res = await supabase.auth.signInWithPassword({ email: loginEmail, password });
        if (res.error) {
          initiatedLoginRef.current = false;
          setAuthError(res.error.message);
        } else {
          if (res.data.user) await set(USER_ID_KEY, res.data.user.id);
          setEmailJustConfirmed(false); // clear confirmation banner on success
          const hash = await hashPassword(password);
          await set(LOCAL_HASH_KEY, hash);
          setIsUnlocked(true);
          setPassword('');
        }
      } else {
        const res = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: 'https://unsent-eosin.vercel.app/'
          }
        });
        if (res.error) {
          setAuthError(res.error.message);
        } else {
          setAuthError('Check your email for the confirmation link!');
        }
      }
    }
  };

  const handleFullLogout = async () => {
    await supabase.auth.signOut();
    await set(LOCAL_HASH_KEY, null);
    // Clear the plaintext entry cache so the diary is not readable from
    // IndexedDB after signing out. Pending entries are kept on purpose —
    // they were never synced, and clearing them would lose the user's words.
    await set(CACHED_ENTRIES_KEY, []);
    const allKeys = await keys();
    await Promise.all(
      allKeys
        .filter(k => typeof k === 'string' && k.startsWith(ATTACHMENT_CACHE_PREFIX))
        .map(k => del(k))
    );
    setSession(null);
    setIsUnlocked(false);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (isOffline) {
      setPasswordMessage('Cannot change password while offline.');
      return;
    }
    setIsChangingPassword(true);
    setPasswordMessage('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPasswordMessage(error.message);
    } else {
      const hash = await hashPassword(newPassword);
      await set(LOCAL_HASH_KEY, hash);
      setPasswordMessage('Password updated successfully!');
      setNewPassword('');
    }
    setIsChangingPassword(false);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      let textContent = "UNSENT DIARY EXPORT\n\n";
      entries.forEach(entry => {
        const date = new Date(entry.created_at).toLocaleString();
        textContent += `--- ${date} ---\n`;
        if (entry.mood) textContent += `Mood: ${entry.mood}\n`;
        textContent += `${entry.content}\n\n`;
      });
      zip.file("diary_entries.txt", textContent);

      zip.file("diary_backup.json", JSON.stringify(entries, null, 2));

      if (!isOffline && entries.some(e => e.entry_attachments && e.entry_attachments.length > 0)) {
        const mediaFolder = zip.folder("attachments");
        for (const entry of entries) {
          if (entry.entry_attachments && entry.entry_attachments.length > 0) {
            // One folder per entry so same-named files can't overwrite each other
            const entryFolder = mediaFolder.folder(`${entry.created_at.slice(0, 10)}_${entry.id.slice(0, 8)}`);
            for (const att of entry.entry_attachments) {
              try {
                const { data, error } = await supabase.storage.from('attachments').download(att.storage_path);
                if (data) {
                  entryFolder.file(att.file_name, data);
                } else if (error) {
                  console.warn("Failed to download attachment", att.file_name, error.message);
                }
              } catch (err) {
                console.warn("Failed to download attachment", att.file_name, err);
              }
            }
          }
        }
      } else if (isOffline) {
        zip.file("NOTICE.txt", "This export was generated while offline. Media attachments could not be downloaded.");
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Unsent_Export_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(err) {
      alert("Failed to export: " + err.message);
    }
    setIsExporting(false);
  };

  const clearDrafts = useCallback(() => {
    draftFiles.forEach(f => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setDraftFiles([]);
  }, [draftFiles]);

  const saveEntry = async () => {
    if (draftContent.trim() === '') return;

    // Offline unlock can happen without a live session — fall back to the
    // locally remembered account so writing still works.
    const userId = session?.user?.id || await get(USER_ID_KEY);
    if (!userId) {
      alert("We couldn't confirm which account this diary belongs to. Please reconnect to the internet and log in once.");
      return;
    }

    const entryId = crypto.randomUUID();
    const newEntry = {
      id: entryId,
      user_id: userId,
      content: draftContent,
      mood: draftMood,
      created_at: new Date().toISOString()
    };

    if (isOffline) {
      if (draftFiles.length > 0) {
        alert("Attachments can't be uploaded while offline — this entry will be saved without them.");
      }
      await saveEntryOffline(newEntry);
      clearDrafts();
      setIsWriting(false);
      loadEntries();
    } else {
      // Insert the entry first so a failed upload can never orphan it
      const { error } = await supabase.from('entries').insert([newEntry]);

      if (error) {
        alert("Error saving entry: " + error.message);
        return;
      }

      const uploadedAttachments = [];
      for (const file of draftFiles) {
        const fileExt = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
        const fileName = `${crypto.randomUUID()}${fileExt}`;
        const filePath = `${userId}/${entryId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(filePath, file);

        if (!uploadError) {
          uploadedAttachments.push({
            entry_id: entryId,
            user_id: userId,
            file_name: file.name,
            file_type: file.type,
            file_size: file.size,
            storage_path: filePath
          });
        } else {
          console.warn('Attachment upload failed:', file.name, uploadError.message);
        }
      }

      if (uploadedAttachments.length > 0) {
        const { error: attachmentError } = await supabase.from('entry_attachments').insert(uploadedAttachments);
        if (attachmentError) {
          // Remove files from storage so they don't linger without DB rows
          await supabase.storage.from('attachments').remove(uploadedAttachments.map(att => att.storage_path));
          alert("Entry saved, but its attachments could not be attached: " + attachmentError.message);
        }
      }

      clearDrafts();
      setIsWriting(false);
      fetchEntriesOnline();
    }
  };

  const handleDeleteEntry = async (entry) => {
    if (!window.confirm("Are you sure you want to delete this entry forever? This action cannot be undone.")) {
      return;
    }

    try {
      const pending = await get(PENDING_SYNC_KEY) || [];
      const cached = await get(CACHED_ENTRIES_KEY) || [];
      const wasSynced = cached.some(e => e.id === entry.id);

      // Remove from the local lists in both modes
      await set(PENDING_SYNC_KEY, pending.filter(e => e.id !== entry.id));
      await set(CACHED_ENTRIES_KEY, cached.filter(e => e.id !== entry.id));

      if (isOffline) {
        // Queue the server-side deletion for the next connection, otherwise
        // the entry would come back on the next sync.
        if (wasSynced) {
          const pendingDeletions = await get(PENDING_DELETIONS_KEY) || [];
          if (!pendingDeletions.includes(entry.id)) {
            pendingDeletions.push(entry.id);
            await set(PENDING_DELETIONS_KEY, pendingDeletions);
          }
        }
      } else {
        // Online Deletion
        if (entry.entry_attachments && entry.entry_attachments.length > 0) {
          const filePaths = entry.entry_attachments.map(att => att.storage_path);
          await supabase.storage.from('attachments').remove(filePaths);
          for (const path of filePaths) {
            await del(`${ATTACHMENT_CACHE_PREFIX}${path}`);
          }
        }

        const { error } = await supabase.from('entries').delete().eq('id', entry.id);
        if (error) throw error;
      }

      setSelectedEntry(null);
      loadEntries();
    } catch (err) {
      alert("Failed to delete entry: " + err.message);
    }
  };

  const onThisDayEntries = useMemo(() => {
    if (!entries.length) return [];
    const today = new Date();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    const thisYear = today.getFullYear();
    
    return entries.filter(entry => {
      const entryDate = new Date(entry.created_at);
      return entryDate.getMonth() === todayMonth && 
             entryDate.getDate() === todayDate && 
             entryDate.getFullYear() < thisYear;
    });
  }, [entries]);

  if (!session || !isUnlocked) {
    return (
      <div className="landing-container">
        {/* Landing Page Content */}
        {!showAuth && (
          <div style={{ textAlign: 'center', marginBottom: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            {emailJustConfirmed && (
              <div style={{ marginBottom: '24px', padding: '12px 20px', borderRadius: '14px', background: 'rgba(200,180,240,0.10)', border: '1px solid rgba(200,180,240,0.25)', color: 'var(--accent-soft-lavender)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem' }}>✓</span> Email confirmed! You can now log in.
              </div>
            )}
            <img 
              src="/android-chrome-512x512.png" 
              alt="Unsent — Private Diary App Icon" 
              style={{ 
                maxWidth: '160px', 
                marginBottom: '20px', 
                borderRadius: '32px',
                boxShadow: '0 0 60px rgba(200, 180, 240, 0.15)'
              }} 
              onError={(e) => e.target.style.display='none'} 
            />
            <div style={{ color: 'var(--accent-soft-lavender)', fontSize: '1.2rem', opacity: 0.7, marginBottom: '20px' }}>✧</div>
            <h1 className="landing-title">
              Unsent
              <span className="locked-badge">
                <Lock size={14} /> Locked
              </span>
            </h1>
            <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', maxWidth: '400px', lineHeight: '1.6', fontFamily: 'var(--font-writing)', marginBottom: '32px' }}>
              A private, offline-capable space for what you need to let out.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
              <button className="btn-secondary" style={{ padding: '12px 32px', fontSize: '1.1rem' }} onClick={() => setShowAuth(true)}>
                {isOffline ? 'Unlock' : (session ? 'Unlock' : 'Log In')}
              </button>
              {deferredPrompt && (
                <button className="btn-primary" style={{ padding: '12px 32px', fontSize: '1.1rem', background: 'var(--accent-soft-lavender)', color: 'var(--bg-deep-navy)' }} onClick={handleInstallClick}>
                  Install App
                </button>
              )}
            </div>


            {/* ── SEO: Semantic feature content (crawlable by Google) ── */}
            <section
              aria-label="App features"
              style={{
                marginTop: '64px',
                maxWidth: '560px',
                textAlign: 'left',
                borderTop: '1px solid var(--border)',
                paddingTop: '40px',
                width: '100%'
              }}
            >
              <h2 style={{ fontSize: '1.3rem', color: 'var(--text-main)', marginBottom: '8px', textAlign: 'center' }}>
                Your private diary, always with you
              </h2>
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '32px', lineHeight: '1.6', fontSize: '0.95rem' }}>
                Unsent is a personal diary app built for privacy. No ads, no tracking — just a safe place to write freely.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {[
                  { Icon: Lock, title: 'Password protected', desc: 'Your entries are locked behind your password and auto-lock when you step away.' },
                  { Icon: WifiOff, title: 'Offline-first', desc: 'Write anywhere — the app works fully offline and syncs when you reconnect.' },
                  { Icon: Mic, title: 'Voice-to-text dictation', desc: 'Speak your thoughts aloud and have them transcribed directly into your diary.' },
                  { Icon: ImageIcon, title: 'Photo & file attachments', desc: 'Attach images, videos, and files to capture the full memory.' },
                  { Icon: Calendar, title: 'Calendar view', desc: 'Browse your past entries by date and revisit memories on this day.' },
                  { Icon: Download, title: 'Export your diary', desc: 'Download all your entries and attachments as a ZIP backup anytime.' },
                ].map(({ Icon, title, desc }) => (
                  <li key={title} style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                    <div style={{ 
                      padding: '10px', 
                      background: 'var(--card-warm-gray)', 
                      borderRadius: '12px', 
                      color: 'var(--accent-soft-lavender)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Icon size={20} />
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-main)', fontSize: '1rem', fontWeight: '500' }}>{title}</strong>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '4px 0 0', lineHeight: '1.6' }}>{desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            {/* ── /SEO section ── */}
          </div>
        )}


        {/* Auth / Unlock Card */}
        {showAuth && (
          <div className="card" style={{ maxWidth: '400px', width: '100%', position: 'relative' }}>
            <button 
              className="btn-secondary" 
              style={{ position: 'absolute', top: '16px', right: '16px', padding: '4px 8px', border: 'none' }} 
              onClick={() => setShowAuth(false)}
            >
              ✕
            </button>
            <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>
              {isOffline ? 'Unlock Journal' : (emailJustConfirmed ? 'Log In' : (session ? 'Unlock Journal' : (isLogin ? 'Log In' : 'Sign Up')))}
            </h2>
            {isOffline && <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '16px', fontSize: '0.9rem' }}>App is offline. Using local lock.</p>}
            {emailJustConfirmed && (
              <p style={{ color: 'var(--accent-soft-lavender)', textAlign: 'center', marginBottom: '16px', fontSize: '0.9rem', background: 'rgba(200,180,240,0.08)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(200,180,240,0.2)' }}>
                ✓ Email confirmed! Enter your password to unlock your diary.
              </p>
            )}
            {authError && <p style={{ color: 'var(--accent-dusty-rose)', textAlign: 'center', marginBottom: '16px' }}>{authError}</p>}
            <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {(!isOffline && (!session || emailJustConfirmed)) && (
                <input 
                  type="email" 
                  placeholder="Your email address" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ padding: '12px', borderBottom: '1px solid var(--accent-soft-lavender)', fontSize: '1rem' }}
                  required={!isOffline}
                />
              )}
              <div style={{ position: 'relative' }}>
                <input 
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', padding: '12px', paddingRight: '44px', borderBottom: '1px solid var(--accent-soft-lavender)', fontSize: '1rem', boxSizing: 'border-box' }}
                  required 
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex', alignItems: 'center' }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: '16px' }}>
                {isOffline ? 'Unlock' : (emailJustConfirmed ? 'Log In' : (session ? 'Unlock' : (isLogin ? 'Log In' : 'Sign Up')))}
              </button>
              
              {(!isOffline && (!session || emailJustConfirmed)) && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', cursor: 'pointer', marginTop: '16px' }} onClick={() => setIsLogin(!isLogin)}>
                  {isLogin ? "Don't have a diary? Start here." : "Already have a diary? Log in."}
                </p>
              )}
            </form>
          </div>
        )}
      </div>
    );
  }

  if (isWriting) {
    return (
      <div className="app-container app-container-fullheight">
        <div className="editor-header">
          <button className="btn-secondary editor-cancel-btn" onClick={() => { setIsWriting(false); clearDrafts(); if(isListening) toggleListening(); }}>
            Cancel
          </button>
          <div className="editor-actions">
            <button 
              onClick={toggleListening}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                border: 'none',
                background: isListening ? 'rgba(255, 99, 132, 0.2)' : 'var(--card-warm-gray)',
                color: isListening ? 'rgb(255, 99, 132)' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
              title={isListening ? "Stop listening" : "Start dictation"}
            >
              {isListening ? (
                 <>
                   <Mic size={20} />
                   <span style={{
                     position: 'absolute',
                     top: 0, left: 0, right: 0, bottom: 0,
                     borderRadius: '50%',
                     border: '2px solid rgb(255, 99, 132)',
                     animation: 'pulse 1.5s infinite'
                   }}></span>
                 </>
              ) : <MicOff size={20} />}
            </button>
            {isOffline && (
              <span className="editor-status" title="Saving locally (offline)">
                <WifiOff size={16} />
                <span className="editor-status-text">Saving locally...</span>
              </span>
            )}
            <button className="btn-primary editor-save-btn" onClick={() => { saveEntry(); if(isListening) toggleListening(); }} disabled={!draftContent.trim()}>
              Save Entry
            </button>
          </div>
        </div>
        <div className="mood-picker" aria-label="How did you feel?">
          {MOODS.map(mood => (
            <button
              key={mood}
              type="button"
              className={`mood-chip ${draftMood === mood ? 'active' : ''}`}
              onClick={() => setDraftMood(mood)}
            >
              {mood}
            </button>
          ))}
        </div>
        <textarea
          className="writing-area"
          placeholder="Write what you couldn't say..."
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          autoFocus
        />
        <AttachmentUploader files={draftFiles} setFiles={setDraftFiles} isOffline={isOffline} />
      </div>
    );
  }


  return (
    <div className="app-container">
      {showSettings && (
        <div className="lightbox-overlay" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: '400px', width: '100%', position: 'relative' }}>
            <button className="btn-secondary" style={{ position: 'absolute', top: '16px', right: '16px', padding: '4px 8px', border: 'none' }} onClick={() => setShowSettings(false)}>✕</button>
            <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><Settings size={24}/> Settings</h2>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '8px' }}>Auto-Lock Time</label>
              <select 
                value={autoLockMinutes} 
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setAutoLockMinutes(val);
                  set('unsent_autolock_time', val);
                }}
                style={{ width: '100%', padding: '12px', background: 'var(--bg-deep-navy)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: '12px', fontSize: '1rem' }}
              >
                <option value={0}>Never</option>
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>

            <div style={{ marginBottom: '24px' }}>
               <label style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '8px' }}>Export Memories</label>
               <button className="btn-secondary" style={{ width: '100%' }} onClick={handleExport} disabled={isExporting || entries.length === 0}>
                 {isExporting ? 'Exporting...' : 'Download Backup (.zip)'}
               </button>
               {isOffline && <p style={{ fontSize: '0.8rem', color: 'var(--accent-dusty-rose)', marginTop: '8px' }}>You are offline. Media attachments cannot be downloaded.</p>}
            </div>

            <div style={{ marginBottom: '24px' }}>
               <label style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '8px' }}>App Installation</label>
               {deferredPrompt ? (
                 <button className="btn-primary" style={{ width: '100%', background: 'var(--accent-soft-lavender)', color: 'var(--bg-deep-navy)' }} onClick={handleInstallClick}>
                   Install Unsent App
                 </button>
               ) : (
                 <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', margin: 0 }}>
                   App is already installed or your browser doesn't support installation here.
                 </p>
               )}
            </div>

            <div style={{ marginBottom: '24px' }}>
               <label style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '8px' }}>Change Password</label>
               <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                 <div style={{ position: 'relative' }}>
                   <input 
                     type={showNewPassword ? 'text' : 'password'}
                     placeholder="New password" 
                     value={newPassword}
                     onChange={(e) => setNewPassword(e.target.value)}
                     style={{ width: '100%', padding: '12px', paddingRight: '44px', background: 'var(--bg-deep-navy)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: '12px', fontSize: '1rem', boxSizing: 'border-box' }}
                     required 
                     disabled={isOffline || isChangingPassword}
                   />
                   <button
                     type="button"
                     onClick={() => setShowNewPassword(v => !v)}
                     style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex', alignItems: 'center' }}
                     tabIndex={-1}
                     aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                   >
                     {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                   </button>
                 </div>
                 <button type="submit" className="btn-secondary" style={{ width: '100%' }} disabled={isOffline || isChangingPassword || !newPassword}>
                   {isChangingPassword ? 'Updating...' : 'Update Password'}
                 </button>
               </form>
               {passwordMessage && <p style={{ fontSize: '0.8rem', color: passwordMessage.includes('success') ? 'var(--accent-soft-lavender)' : 'var(--accent-dusty-rose)', marginTop: '8px' }}>{passwordMessage}</p>}
               {isOffline && <p style={{ fontSize: '0.8rem', color: 'var(--accent-dusty-rose)', marginTop: '8px' }}>You are offline. Password cannot be changed.</p>}
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1>Unsent</h1>
          {isOffline && <span style={{ background: 'var(--card-warm-gray)', color: 'var(--text-muted)', padding: '4px 12px', borderRadius: '16px', fontSize: '0.8rem' }}>Offline Mode</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary header-btn" style={{ padding: '8px', border: 'none' }} onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={20} />
          </button>
          <button className="btn-secondary header-btn" onClick={handleLock} title="Lock">
            <Lock size={18} />
            <span className="btn-text">Lock</span>
          </button>
          {!isOffline && (
            <button className="btn-secondary header-btn" onClick={handleFullLogout} title="Sign Out">
              <LogOut size={18} />
              <span className="btn-text">Sign Out</span>
            </button>
          )}
        </div>
      </header>

      {selectedEntry && (
        <div style={{ marginBottom: '32px' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
             <button className="btn-secondary" style={{ padding: '8px 16px', border: 'none' }} onClick={() => setSelectedEntry(null)}>
                ← Back
             </button>
             <button className="btn-secondary" style={{ padding: '8px 16px', border: 'none', color: 'var(--accent-dusty-rose)' }} onClick={() => handleDeleteEntry(selectedEntry)}>
                Delete Entry
             </button>
           </div>
           <div className="card">
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                <span>{new Date(selectedEntry.created_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                {selectedEntry.mood && <span style={{ background: 'var(--accent-soft-lavender)', color: 'var(--bg-deep-navy)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>{selectedEntry.mood}</span>}
              </div>
              <p style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap', fontSize: '1.1rem' }}>{selectedEntry.content}</p>
              
              <AttachmentViewer attachments={selectedEntry.entry_attachments} isOffline={isOffline} />
            </div>
        </div>
      )}

      {!selectedEntry && (
        <>
          <nav className="nav-bar">
            <button className={`nav-item ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}><Book size={18}/> Entries</button>
            <button className={`nav-item ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}><Search size={18}/> Find Memory</button>
            <button className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')}><Calendar size={18}/> Your Days</button>
          </nav>

          {activeTab === 'list' && (
            <>
              {onThisDayEntries.length > 0 && (
                <div className="card" style={{ marginBottom: '32px', border: '1px solid var(--accent-soft-lavender)', background: 'linear-gradient(135deg, var(--card-warm-gray) 0%, rgba(200, 180, 240, 0.05) 100%)' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-soft-lavender)', marginBottom: '16px', fontSize: '1.1rem' }}>
                    <Calendar size={20} /> On this day...
                  </h3>
                  {onThisDayEntries.map(entry => (
                    <div key={entry.id} {...clickableProps(() => setSelectedEntry(entry))} style={{ cursor: 'pointer', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', marginBottom: '8px' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px' }}>
                        {new Date(entry.created_at).getFullYear()}
                      </div>
                      <p style={{ fontSize: '0.95rem', lineHeight: '1.5', whiteSpace: 'pre-wrap', color: 'var(--text-main)', opacity: 0.9 }}>
                        {entry.content.substring(0, 150)}
                        {entry.content.length > 150 ? '...' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <button className="btn-primary btn-new-entry" onClick={() => setIsWriting(true)}>
                  New Entry
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {loading ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Opening diary...</p>
                ) : entries.length > 0 ? (
                  entries.map(entry => (
                    <div key={entry.id} className="card" {...clickableProps(() => setSelectedEntry(entry))} style={{ cursor: 'pointer' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{new Date(entry.created_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                        {entry.mood && <span style={{ background: 'var(--accent-soft-lavender)', color: 'var(--bg-deep-navy)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>{entry.mood}</span>}
                      </div>
                      <p style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                        {entry.content.substring(0, 300)}
                        {entry.content.length > 300 ? '...' : ''}
                      </p>
                      {entry.entry_attachments && entry.entry_attachments.length > 0 && (
                        <div style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          📎 {entry.entry_attachments.length} attachment{entry.entry_attachments.length > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Your diary is empty. Write your first thought.</p>
                )}
              </div>
            </>
          )}

          {activeTab === 'search' && (
            <SearchPage entries={entries} onSelectEntry={setSelectedEntry} />
          )}

          {activeTab === 'calendar' && (
            <CalendarView entries={entries} onSelectEntry={setSelectedEntry} />
          )}
        </>
      )}
    </div>
  );
}

export default App;
