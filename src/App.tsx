import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const categories = [
  'Vocals',
  'Costume',
  'Choreography',
  'Special Effects',
  'Originality',
  'Stage Presence',
  'Catchiness',
  'Camp Factor',
  'Prop Utility',
  'Camerawork',
  'Bop-ability',
  'Overall Score'
];

const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;
const socket = io(API_BASE, { autoConnect: true });

export default function App() {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [statusText, setStatusText] = useState('');
  const [user, setUser] = useState<any>(null);
  const [sessionState, setSessionState] = useState<any>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [scores, setScores] = useState<Record<string, number>>(() => Object.fromEntries(categories.map((c) => [c, 5])));
  const [favourite, setFavourite] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCountryId, setPendingCountryId] = useState<number | null>(null);
  const [isSelectingCountry, setIsSelectingCountry] = useState(false);
  const [roomNotices, setRoomNotices] = useState<Array<{ id: number; message: string; type: string; firstName?: string }>>([]);
  const [introCountdown, setIntroCountdown] = useState<number | null>(null);
  const [scoringIntroCountdown, setScoringIntroCountdown] = useState<number | null>(null);
  const [revealedVoteCount, setRevealedVoteCount] = useState(0);
  const [finalRevealStage, setFinalRevealStage] = useState(0);
  const [finalCountryRevealCount, setFinalCountryRevealCount] = useState(0);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const revealScrollRef = useRef<HTMLDivElement>(null);
  const prevAllSubmittedRef = useRef(false);

  const focusRevealRow = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const scrollContainer = revealScrollRef.current;
    if (!scrollContainer) return;
    const containerRect = scrollContainer.getBoundingClientRect();
    const rowRect = node.getBoundingClientRect();
    const targetScrollTop = scrollContainer.scrollTop + rowRect.top - containerRect.top - containerRect.height / 2 + rowRect.height / 2;
    scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/session`)
      .then((r) => r.json())
      .then((state) => {
        setSessionState(state);
        setIsBootstrapping(false);
      })
      .catch(() => setIsBootstrapping(false));

    socket.on('session:update', (state) => {
      setSessionState(state);
      setIsBootstrapping(false);
    });
    socket.on('lobby:notice', (notice) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const nextNotice = { id, ...notice };
      setRoomNotices((prev) => [...prev.slice(-2), nextNotice]);
      window.setTimeout(() => {
        setRoomNotices((prev) => prev.filter((entry) => entry.id !== id));
      }, 3600);

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const gain = ctx.createGain();
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);

          const notes = notice.type === 'rejoin' ? [659.25, 783.99, 987.77] : [523.25, 659.25, 783.99];
          notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            osc.type = index === 2 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.09);
            osc.connect(gain);
            osc.start(ctx.currentTime + index * 0.09);
            osc.stop(ctx.currentTime + index * 0.09 + 0.18);
          });

          window.setTimeout(() => ctx.close().catch(() => undefined), 700);
        }
      } catch {}
    });
    return () => {
      socket.off('session:update');
      socket.off('lobby:notice');
    };
  }, []);

  // Reset scores when moving to a new country so each scorecard starts fresh at 5
  useEffect(() => {
    if (sessionState?.session?.phase === 'scoring' || sessionState?.session?.phase === 'scoring-intro') {
      setScores(Object.fromEntries(categories.map((c) => [c, 5])));
      setStatusText('');
      setHasSubmitted(false);
      prevAllSubmittedRef.current = false;
    }
  }, [sessionState?.session?.current_country_index, sessionState?.session?.scoring_country_id, sessionState?.currentCountry?.id, sessionState?.session?.phase]);

  // Clear submitted state when leaving the scoring phase
  useEffect(() => {
    if (sessionState?.session?.phase !== 'scoring') {
      setHasSubmitted(false);
      prevAllSubmittedRef.current = false;
    }
  }, [sessionState?.session?.phase]);

  const total = useMemo(() => Object.values(scores).reduce((a, b) => a + b, 0), [scores]);

  useEffect(() => {
    if (sessionState?.session?.phase === 'intro') {
      const selectedId = sessionState?.session?.selected_country_id ?? null;
      setPendingCountryId(selectedId);
      setIntroCountdown(selectedId ? 5 : null);
    } else if (sessionState?.session?.phase === 'preshow') {
      setIntroCountdown(null);
    } else {
      setPendingCountryId(null);
      setIsSelectingCountry(false);
      setIntroCountdown(null);
    }
  }, [sessionState?.session?.phase, sessionState?.session?.selected_country_id]);

  useEffect(() => {
    if (sessionState?.session?.phase !== 'scoring-intro') {
      setScoringIntroCountdown(null);
      return;
    }

    setScoringIntroCountdown(2);
  }, [sessionState?.session?.phase, sessionState?.session?.scoring_country_id]);

  const requestFullscreen = async () => {
    try {
      const el = document.documentElement as any;
      if (!document.fullscreenElement && el?.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch {}
  };

  const handleJoin = async () => {
    setError('');
    setStatusText('');
    const res = await fetch(`${API_BASE}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: name })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Join failed');
      return;
    }
    setUser(data.user);
    setSessionState(data.state);
    setJoined(true);
    setIsBootstrapping(false);
    setFavourite(data.state?.currentCountry?.name || '');
    setStatusText(data.relogin ? 'Welcome back — you rejoined as the same player.' : '');
    requestFullscreen();
  };

  const submitScores = async () => {
    if (!user?.id || isSubmitting) return;
    setIsSubmitting(true);
    setStatusText('');
    try {
      const res = await fetch(`${API_BASE}/api/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, breakdown: scores })
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusText(data.error || 'Score submission failed');
        return;
      }
      setSessionState(data.state);
      setHasSubmitted(true);
      setStatusText(`Scores locked in — ${data.totalScore} points!`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetApp = async () => {
    const confirmed = window.confirm('Reset the whole session, users, and scores?');
    if (!confirmed) return;
    await fetch(`${API_BASE}/api/reset`, { method: 'POST' });
    setJoined(false);
    setUser(null);
    setName('');
    setShowAdmin(false);
    setStatusText('');
  };

  const moveCountry = async (direction: 'next' | 'previous') => {
    if (!user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/session/${direction}-country`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusText(data.error || 'Could not update current country');
        return;
      }
      setSessionState(data.state);
    } catch (err: any) {
      setStatusText(err?.message || 'Network error — could not reach server');
    }
  };

  const selectNextCountry = async () => {
    if (!user?.id || !pendingCountryId || isSelectingCountry) return;
    setIsSelectingCountry(true);
    setStatusText('');
    try {
      const res = await fetch(`${API_BASE}/api/session/select-country`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, countryId: pendingCountryId })
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusText(data.error || 'Could not select the next country');
        return;
      }
      setSessionState(data.state);
      // In preshow, auto-advance to scoring after confirming the opener
      if (data.state?.session?.phase === 'preshow') {
        await moveCountry('next');
        return;
      }
      setStatusText('Next country locked in. Start scoring when ready.');
    } finally {
      setIsSelectingCountry(false);
    }
  };

  const simulateFinale = async () => {
    if (!user?.id) return;
    setStatusText('');
    const res = await fetch(`${API_BASE}/api/session/simulate-finale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id })
    });
    const data = await res.json();
    if (!res.ok) {
      setStatusText(data.error || 'Could not simulate final results');
      return;
    }
    setSessionState(data.state);
    setStatusText('Final results simulation loaded.');
  };

  const currentCountry = sessionState?.currentCountry;
  const countries = sessionState?.countries || [];
  const users = sessionState?.users || [];
  const leaderboard = sessionState?.leaderboard || [];
  const resultsView = sessionState?.resultsView;
  const finalResults = sessionState?.finalResults;
  const phase = sessionState?.session?.phase || 'scoring';
  const me = users.find((u: any) => u.id === user?.id) || user;
  const currentIndex = sessionState?.session?.current_country_index ?? 0;
  const selectedCountryId = sessionState?.session?.selected_country_id ?? null;
  const currentCountryLeaderboardEntry = currentCountry ? leaderboard.find((c: any) => c.id === currentCountry.id) : null;
  const allSubmitted = phase === 'scoring' && users.length > 0 && currentCountryLeaderboardEntry ? currentCountryLeaderboardEntry.submittedBy >= users.length : false;

  // Play sound when all players have submitted
  useEffect(() => {
    if (allSubmitted && !prevAllSubmittedRef.current) {
      prevAllSubmittedRef.current = true;
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const gain = ctx.createGain();
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.0);

          const notes = [523.25, 659.25, 783.99, 1046.50];
          notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            osc.type = index === 3 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.12);
            osc.connect(gain);
            osc.start(ctx.currentTime + index * 0.12);
            osc.stop(ctx.currentTime + index * 0.12 + 0.3);
          });

          window.setTimeout(() => ctx.close().catch(() => undefined), 1200);
        }
      } catch {}
    }
    if (!allSubmitted) {
      prevAllSubmittedRef.current = false;
    }
  }, [allSubmitted]);
  const manualSelectionCountry = countries.find((country: any) => country.id === (pendingCountryId ?? selectedCountryId)) || null;
  const alreadyScoredCountryIds = new Set(leaderboard.filter((country: any) => country.submittedBy > 0).map((country: any) => country.id));
  const upcomingCountries = countries.filter((country: any) => !alreadyScoredCountryIds.has(country.id) && country.id !== resultsView?.country?.id);
  const performedCountries = countries.filter((country: any) => alreadyScoredCountryIds.has(country.id) || country.id === resultsView?.country?.id);
  const progressLabel = `${Math.min(currentIndex + 1, countries.length)}/${countries.length}`;

  useEffect(() => {
    if (phase !== 'results' || !resultsView) {
      setRevealedVoteCount(0);
      return;
    }

    setRevealedVoteCount(0);
    const votes = resultsView.votes || [];
    const timers: number[] = votes.map((_: any, index: number) => window.setTimeout(() => {
      setRevealedVoteCount(index + 1);
    }, 850 + index * 220));

    return () => timers.forEach((timer: number) => window.clearTimeout(timer));
  }, [phase, resultsView?.country?.id]);

  useEffect(() => {
    if (phase !== 'intro' || !selectedCountryId || introCountdown == null || !user?.is_admin) return;
    if (introCountdown <= 0) {
      void moveCountry('next');
      return;
    }

    const timer = window.setTimeout(() => setIntroCountdown((prev) => (prev == null ? prev : prev - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, selectedCountryId, introCountdown, user?.is_admin]);

  useEffect(() => {
    if (phase !== 'scoring-intro' || scoringIntroCountdown == null) return;
    if (scoringIntroCountdown <= 0) {
      if (user?.is_admin) {
        void moveCountry('next');
      }
      return;
    }

    const timer = window.setTimeout(() => setScoringIntroCountdown((prev) => (prev == null ? prev : prev - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, scoringIntroCountdown, user?.is_admin]);

  useEffect(() => {
    if (phase !== 'finished' || !finalResults) {
      setFinalRevealStage(0);
      setFinalCountryRevealCount(0);
      return;
    }

    setFinalRevealStage(0);
    setFinalCountryRevealCount(0);

    const revealOrder = [...finalResults.countryResults].reverse();
    const timers: number[] = [window.setTimeout(() => setFinalRevealStage(1), 1200)];

    let elapsed = 2000;
    revealOrder.forEach((_: any, reverseIndex: number) => {
      const isPodium = reverseIndex >= Math.max(revealOrder.length - 3, 0);
      timers.push(window.setTimeout(() => setFinalCountryRevealCount(reverseIndex + 1), elapsed));
      elapsed += isPodium ? 5000 : 2000;
    });

    timers.push(window.setTimeout(() => setFinalRevealStage(2), elapsed + 1200));
    timers.push(window.setTimeout(() => setFinalRevealStage(3), elapsed + 3200));

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase, finalResults?.winner?.id]);

  const noticeStack = roomNotices.length ? (
    <div className="room-notice-stack">
      {roomNotices.map((notice) => (
        <div key={notice.id} className={`room-notice room-notice-${notice.type}`}>
          <div className="room-notice-avatar">{(notice.firstName || notice.message || '?').trim().charAt(0).toUpperCase()}</div>
          <div className="room-notice-copy">
            <strong>{notice.firstName || 'Player'}</strong>
            <span>{notice.type === 'rejoin' ? 'rejoined the room' : 'joined the room'}</span>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  if (isBootstrapping) {
    return (
      <div className="app-shell auth-shell">
        <div className="auth-panel loading-panel">
          <div className="auth-glow" />
          <div className="loading-orb-ring" />
          <div className="brand-mark loading-brand">✦ Eurovision Party</div>
          <div className="loading-flag pop-in">🎤</div>
          <h1>Rejoining live room…</h1>
          <p className="muted">Syncing the current country, phase, and player list.</p>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="app-shell auth-shell">
        <div className="auth-panel">
          <div className="auth-glow" />
          <div className="brand-mark">✦ Eurovision Party</div>
          <h1>Join the scoring room</h1>
          <p className="muted">Enter your first name and jump straight into the live vote.</p>
          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.95rem', lineHeight: 1.5 }}>
            Created by Peter Bennett as a free-to-use companion for Eurovision watch parties — built to make the night more fun, interactive, and a little more dramatic.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="First name"
            className="text-input"
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          <button className="primary-btn full-width" onClick={handleJoin}>
            Join Session
          </button>
        </div>
      </div>
    );
  }

  // ─── FULL-SCREEN: RESULTS REVEAL ────────────────────────────
  if (phase === 'preshow') {
    return (
      <>
        {noticeStack}
        <div className="fullscreen-overlay country-intro" key="preshow">
          <div className="reveal-backdrop intro-backdrop" />
          <div className="reveal-scroll">
            <header className="reveal-topbar">
              <div className="brand-mark small">✦ Eurovision Party</div>
              <div className="reveal-progress">Pre-Show</div>
              <div className="profile-chip mini">
                <span>{me?.first_name}</span>
              </div>
            </header>

            <div className="reveal-hero intro-hero">
              <div className="intro-kicker fade-up" style={{ animationDelay: '0ms' }}>Welcome to the live final</div>
              <div className="reveal-flag pop-in intro-flag" style={{ animationDelay: '180ms' }}>🎤</div>
              <div className="section-tag fade-up" style={{ animationDelay: '320ms' }}>Awaiting Opening Act</div>
              <h1 className="reveal-title fade-up" style={{ animationDelay: '460ms' }}>The show is about to begin</h1>
              <p className="reveal-meta fade-up" style={{ animationDelay: '620ms' }}>
                {users.length} {users.length === 1 ? 'player' : 'players'} in the room. Ready when you are!
              </p>
            </div>
          </div>

          {statusText && <div className="status-banner" style={{ margin: '0 20px' }}>{statusText}</div>}

          <footer className="reveal-footer fade-up" style={{ animationDelay: '800ms' }}>
            {user?.is_admin ? (
              <div className="reveal-actions">
                <button className="primary-btn compact-btn glow-pulse" onClick={() => moveCountry('next')}>
                  Start the Show →
                </button>
              </div>
            ) : (
              <div className="reveal-waiting">
                <span className="waiting-dot" />
                <span>Waiting for the leader to start the show…</span>
              </div>
            )}
          </footer>
        </div>
      </>
    );
  }

  if (phase === 'results' && resultsView) {
    return (
      <>
        {noticeStack}
        <div className="fullscreen-overlay results-reveal" key={`results-${resultsView.country.id}`}>
        <div className="reveal-backdrop" />

        <div className="reveal-scroll">
          <header className="reveal-topbar">
            <div className="brand-mark small">✦ Eurovision Party</div>
            <div className="reveal-progress">Country {progressLabel}</div>
            <div className="profile-chip mini">
              <span>{me?.first_name}</span>
            </div>
          </header>

          <div className="reveal-hero">
            <div className="reveal-flag pop-in" style={{ animationDelay: '0ms' }}>{resultsView.country.flag}</div>
            <div className="section-tag fade-up" style={{ animationDelay: '200ms' }}>Performance Complete</div>
            <h1 className="reveal-title fade-up" style={{ animationDelay: '350ms' }}>{resultsView.country.name}</h1>
            <p className="reveal-meta fade-up" style={{ animationDelay: '500ms' }}>
              {resultsView.submittedBy} of {users.length} players voted
            </p>
          </div>

          <div className="reveal-stats fade-up" style={{ animationDelay: '600ms' }}>
            <div className="stat-orb">
              <span>Voters</span>
              <strong>{resultsView.submittedBy}</strong>
              <small>of {users.length}</small>
            </div>
          </div>

          {(() => {
            const submittedVotes = resultsView.votes.filter((v: any) => v.submitted && v.breakdown);
            if (submittedVotes.length === 0) return null;
            const catHighest: Record<string, { name: string; value: number }> = {};
            for (const vote of submittedVotes) {
              for (const [cat, val] of Object.entries(vote.breakdown)) {
                const v = val as number;
                if (!catHighest[cat] || v > catHighest[cat].value) {
                  catHighest[cat] = { name: vote.first_name, value: v };
                }
              }
            }
            return (
              <div className="reveal-category-leaders fade-up" style={{ animationDelay: '650ms' }}>
                <h2 className="reveal-section-title" style={{ marginBottom: '0.5rem' }}>Highest Scorers by Category</h2>
                <div className="category-leader-grid">
                  {Object.entries(catHighest).map(([cat, info]) => (
                    <div key={cat} className="category-leader-chip">
                      <span className="leader-cat">{cat}</span>
                      <span className="leader-name">{info.name}</span>
                      <span className="leader-score">{info.value}/10</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="reveal-votes-section">
            <h2 className="reveal-section-title fade-up" style={{ animationDelay: '750ms' }}>How Everyone Voted</h2>
            <div className="vote-cards">
              {resultsView.votes.map((vote: any, index: number) => {
                const isRevealed = index < revealedVoteCount;
                return (
                <div
                  key={vote.userId}
                  className={`vote-card cascade-in${index === 0 && vote.submitted ? ' top-voter' : ''}${!vote.submitted ? ' no-vote' : ''}${isRevealed ? ' revealed' : ' pending-reveal'}`}
                  style={{ animationDelay: `${index * 180 + 900}ms` }}
                >
                  <div className="vote-card-position">
                    {vote.submitted ? (
                      <span className={index === 0 ? 'pos gold' : index === 1 ? 'pos silver' : index === 2 ? 'pos bronze' : 'pos'}>
                        {index + 1}
                      </span>
                    ) : (
                      <span className="pos dim">—</span>
                    )}
                  </div>
                  <div className="vote-card-body">
                    <strong>{vote.first_name}{vote.is_admin ? ' ★' : ''}</strong>
                    {vote.submitted && vote.breakdown && (
                      <div className="vote-breakdown">
                        {Object.entries(vote.breakdown).map(([cat, val]) => (
                          <div key={cat} className="breakdown-cell">
                            <span className="breakdown-label">{cat}</span>
                            <span className="breakdown-value">{val as number}/10</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!vote.submitted && <span className="muted small-text">Did not vote</span>}
                  </div>
                  <div className="vote-card-total">
                    {vote.submitted ? (
                      isRevealed ? <><strong>{vote.totalScore}</strong><small>pts</small></> : <span className="reveal-placeholder">…</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </div>
        </div>

        <footer className="reveal-footer fade-up" style={{ animationDelay: `${resultsView.votes.length * 180 + 1200}ms` }}>
          {user?.is_admin ? (
            <div className="reveal-actions">
              <button className="secondary-btn compact-btn" onClick={() => moveCountry('previous')}>
                ← Back to Scoring
              </button>
              <button className="primary-btn compact-btn glow-pulse" onClick={() => moveCountry('next')}>
                Next Country →
              </button>
            </div>
          ) : (
            <div className="reveal-waiting">
              <span className="waiting-dot" />
              <span>Waiting for the leader to continue…</span>
            </div>
          )}
        </footer>
      </div>
      </>
    );
  }

  // ─── FULL-SCREEN: NEXT COUNTRY INTRO ────────────────────────
  if (phase === 'intro') {
    return (
      <>
        {noticeStack}
        <div className="fullscreen-overlay country-intro" key={`intro-${selectedCountryId ?? 'pending'}`}>
        <div className="reveal-backdrop intro-backdrop" />

        <div className="reveal-scroll">
          <header className="reveal-topbar">
            <div className="brand-mark small">✦ Eurovision Party</div>
            <div className="reveal-progress">Choose Next Country</div>
            <div className="profile-chip mini">
              <span>{me?.first_name}</span>
            </div>
          </header>

          <div className="reveal-hero intro-hero">
            <div className="intro-kicker fade-up" style={{ animationDelay: '0ms' }}>Manual running order</div>
            <div className="reveal-flag pop-in intro-flag" style={{ animationDelay: '180ms' }}>
              {manualSelectionCountry?.flag || '🎤'}
            </div>
            <div className="section-tag fade-up" style={{ animationDelay: '320ms' }}>
              {manualSelectionCountry ? 'Next Country Selected' : 'Awaiting Selection'}
            </div>
            <h1 className="reveal-title fade-up" style={{ animationDelay: '460ms' }}>
              {manualSelectionCountry?.name || 'Choose the next act'}
            </h1>
            <p className="reveal-meta fade-up" style={{ animationDelay: '620ms' }}>
              The leader now chooses the next country manually, then confirms before scoring starts.
            </p>
          </div>

          <div className="reveal-stats fade-up" style={{ animationDelay: '760ms' }}>
            <div className="stat-orb main-stat intro-stat">
              <span>Selected</span>
              <strong>{manualSelectionCountry?.flag || '—'}</strong>
              <small>{manualSelectionCountry?.name || 'Not locked in yet'}</small>
            </div>
            <div className="stat-orb intro-stat">
              <span>Countries Left</span>
              <strong>{upcomingCountries.length}</strong>
              <small>available to perform</small>
            </div>
            <div className="stat-orb intro-stat">
              <span>Players Ready</span>
              <strong>{users.length}</strong>
              <small>waiting for the next act</small>
            </div>
            {selectedCountryId && (
              <div className="stat-orb intro-stat countdown-orb">
                <span>Countdown</span>
                <strong>{introCountdown ?? 0}</strong>
                <small>until scoring starts</small>
              </div>
            )}
          </div>

          {user?.is_admin ? (
            <div className="intro-selection-panel fade-up" style={{ animationDelay: '900ms' }}>
              <div className="intro-panel-glow" />
              <div className="intro-panel-content">
                <div className="section-tag">Choose carefully</div>
                <h2>Select the next country</h2>
                <p>Tap a country below, then use the confirm button to lock it in and avoid misclicks.</p>
                <div className="intro-country-grid">
                  {upcomingCountries.map((country: any) => {
                    const isActive = (pendingCountryId ?? selectedCountryId) === country.id;
                    return (
                      <button
                        key={country.id}
                        className={isActive ? 'intro-country-btn active' : 'intro-country-btn'}
                        onClick={() => setPendingCountryId(country.id)}
                      >
                        <span className="intro-country-flag">{country.flag}</span>
                        <span className="intro-country-name">{country.name}</span>
                      </button>
                    );
                  })}
                </div>
                {performedCountries.length > 0 && (
                  <div className="performed-strip">
                    <div className="section-tag">Performed</div>
                    <div className="performed-badges">
                      {performedCountries.map((country: any) => (
                        <span key={country.id} className="performed-badge">
                          <span>{country.flag}</span>
                          <span>{country.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="intro-panel fade-up" style={{ animationDelay: '900ms' }}>
              <div className="intro-panel-glow" />
              <div className="intro-panel-content">
                <div className="section-tag">Stand by</div>
                <h2>Waiting for the leader’s selection</h2>
                <p>
                  {manualSelectionCountry
                    ? <>Next up is <strong>{manualSelectionCountry.flag} {manualSelectionCountry.name}</strong>. Scoring will begin once the leader confirms.</>
                    : 'The next country has not been chosen yet.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="reveal-footer fade-up" style={{ animationDelay: '1100ms' }}>
          {user?.is_admin ? (
            <div className="reveal-actions">
              <button className="secondary-btn compact-btn" onClick={() => moveCountry('previous')}>
                ← Back to Results
              </button>
              <button className="secondary-btn compact-btn" onClick={selectNextCountry} disabled={!pendingCountryId || isSelectingCountry}>
                {isSelectingCountry ? 'Confirming…' : 'Confirm Country'}
              </button>
              <button className="primary-btn compact-btn glow-pulse" onClick={() => moveCountry('next')} disabled={!selectedCountryId}>
                Start Scoring →
              </button>
            </div>
          ) : (
            <div className="reveal-waiting">
              <span className="waiting-dot" />
              <span>{manualSelectionCountry ? `Waiting for the leader to start ${manualSelectionCountry.name}…` : 'Waiting for the leader to choose the next country…'}</span>
            </div>
          )}
        </footer>
      </div>
      </>
    );
  }

  // ─── FULL-SCREEN: FINAL RESULTS ─────────────────────────────
  if (phase === 'scoring-intro' && currentCountry) {
    return (
      <>
        {noticeStack}
        <div className="fullscreen-overlay scoring-intro-screen">
          <div className="reveal-backdrop intro-backdrop" />
          <div className="reveal-scroll scoring-intro-wrap">
            <div className="scoring-intro-panel fade-up">
              <div className="section-tag">Now Scoring</div>
              <div className="reveal-flag pop-in intro-flag">{currentCountry.flag}</div>
              <h1 className="reveal-title">{currentCountry.name}</h1>
              <p className="reveal-meta">Get your scorecards ready.</p>
              <div className="scoring-intro-count">{scoringIntroCountdown ?? 0}</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (phase === 'finished' && finalResults) {
    return (
      <>
        {noticeStack}
        <div className="fullscreen-overlay final-screen">
        <div className="reveal-backdrop final-backdrop" />

        <div className="reveal-scroll" ref={revealScrollRef}>
          <header className="reveal-topbar">
            <div className="brand-mark small">✦ Eurovision Party</div>
            <div className="reveal-progress">Final Results</div>
          </header>

          <section className={`final-section final-cadence-section${finalRevealStage >= 1 ? ' final-visible' : ' final-hidden'}`}>
            <h2 className="final-section-title">🏆 Country Rankings</h2>
            <div className="final-leaderboard">
              {[...finalResults.countryResults].reverse().map((country: any, reverseIndex: number) => {
                const index = finalResults.countryResults.length - 1 - reverseIndex;
                const isRevealed = reverseIndex < finalCountryRevealCount;
                const isCurrentFocus = reverseIndex === finalCountryRevealCount - 1;
                const favouritePickers = finalResults.playerRankings.filter((player: any) => player.favouriteCountryName === country.name);
                return (
                <div
                  key={country.id}
                  ref={isCurrentFocus ? focusRevealRow : undefined}
                  className={`final-row ${isRevealed ? 'animate__animated animate__flipInX animate__faster' : ''}${index === 0 ? ' gold-row podium-row podium-gold' : index === 1 ? ' silver-row podium-row podium-silver' : index === 2 ? ' bronze-row podium-row podium-bronze' : ''}${isRevealed ? ' final-row-visible' : ' final-row-hidden'}${isCurrentFocus ? ' podium-focus current-reveal-focus' : ''}${index === 0 && isCurrentFocus ? ' winner-focus' : ''}`}
                >
                  <div className="final-rank-num">
                    {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                  </div>
                  <div className="final-row-flag-wrap">
                    <div className="final-row-flag">{country.flag}</div>
                    <div className="final-row-flag-name">{country.name}</div>
                  </div>
                  <div className="final-row-info">
                    <strong>{country.name}</strong>
                    <small className="muted">
                      {country.votes.filter((v: any) => v.submitted).length} votes
                    </small>
                    {isRevealed && favouritePickers.length > 0 && (
                      <div className="favourite-pickers">
                        {favouritePickers.map((player: any) => (
                          <span key={player.id} className="favourite-picker-chip" title={`${player.first_name} picked this as favourite`}>
                            {player.first_name.charAt(0).toUpperCase()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="final-row-score">{country.totalScore}</div>
                </div>
              )})}
            </div>
          </section>

          {finalResults.winner && finalCountryRevealCount >= finalResults.countryResults.length && (
            <div className={`winner-celebration winner-celebration-finale${finalRevealStage >= 1 ? ' final-visible' : ' final-hidden'}`}>
              <div className="winner-sparkles">
                <span className="sparkle s1">✦</span>
                <span className="sparkle s2">✦</span>
                <span className="sparkle s3">✦</span>
                <span className="sparkle s4">✦</span>
                <span className="sparkle s5">✦</span>
                <span className="sparkle s6">✦</span>
              </div>
              <div className="winner-crown pop-in" style={{ animationDelay: '200ms' }}>👑</div>
              <div className="section-tag gold fade-up" style={{ animationDelay: '400ms' }}>Winner</div>
              <div className="winner-flag pop-in" style={{ animationDelay: '600ms' }}>{finalResults.winner.flag}</div>
              <h1 className="winner-name fade-up" style={{ animationDelay: '800ms' }}>{finalResults.winner.name}</h1>
              <div className="winner-score fade-up" style={{ animationDelay: '1000ms' }}>
                {finalResults.winner.totalScore} points
              </div>
              <div className="winner-subtitle fade-up" style={{ animationDelay: '1200ms' }}>
                🎉 Congratulations 🎉
              </div>
            </div>
          )}

          <section className={`final-section final-cadence-section${finalRevealStage >= 2 ? ' final-visible' : ' final-hidden'}`}>
            <h2 className="final-section-title">⭐ Player Rankings</h2>
            <div className="final-leaderboard">
              {finalResults.playerRankings.map((player: any, index: number) => (
                <div
                  key={player.id}
                  className={`final-row player-row cascade-in${finalRevealStage >= 2 ? ' final-row-visible' : ' final-row-hidden'}`}
                  style={{ animationDelay: `${index * 180 + 200}ms` }}
                >
                  <div className="final-rank-num">{index + 1}</div>
                  <div className="final-row-info">
                    <strong>{player.first_name}{player.is_admin ? ' ★' : ''}</strong>
                    <small className="muted">
                      {player.countriesVoted} countries voted
                      {player.favouriteCountryName && (
                        <> · Gave most to {player.favouriteCountryFlag} {player.favouriteCountryName}</>
                      )}
                    </small>
                  </div>
                  <div className="final-row-score">{player.grandTotal}</div>
                </div>
              ))}
            </div>
          </section>

          <section className={`final-section final-cadence-section${finalRevealStage >= 3 ? ' final-visible' : ' final-hidden'}`}>
            <h2 className="final-section-title">📊 Full Voting Breakdown</h2>
            <div className="matrix-wrapper">
              <div className="votes-matrix">
                <div className="matrix-header">
                  <div className="matrix-cell corner">Country</div>
                  {finalResults.playerRankings.map((player: any) => (
                    <div key={player.id} className="matrix-cell player-header">{player.first_name}</div>
                  ))}
                  <div className="matrix-cell total-header">Total</div>
                </div>
                {finalResults.countryResults.map((country: any, ci: number) => (
                  <div key={country.id} className={`matrix-row${ci === 0 ? ' winner-matrix-row' : ''}`}>
                    <div className="matrix-cell country-cell">
                      <span className="matrix-flag">{country.flag}</span>
                      <span className="matrix-name">{country.name}</span>
                    </div>
                    {finalResults.playerRankings.map((player: any) => {
                      const vote = country.votes.find((v: any) => v.userId === player.id);
                      return (
                        <div key={player.id} className={`matrix-cell vote-cell${vote?.submitted ? '' : ' empty'}`}>
                          {vote?.submitted ? vote.totalScore : '—'}
                        </div>
                      );
                    })}
                    <div className="matrix-cell total-cell">{country.totalScore}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {user?.is_admin && (
          <footer className="reveal-footer">
            <div className="reveal-actions">
              <button className="secondary-btn compact-btn" onClick={() => moveCountry('previous')}>← Back to Last Results</button>
              <button className="secondary-btn compact-btn danger-btn" onClick={resetApp}>Reset Session</button>
            </div>
          </footer>
        )}
      </div>
      </>
    );
  }

  // ─── SCORING PHASE ──────────────────────────────────────────
  return (
    <>
      {noticeStack}
      <div className="app-shell app-frame">
      <header className="app-topbar">
        <div className="topbar-main">
          <div className="brand-mark small">✦ Eurovision Party</div>
          <div className="context-block">
            <div className="phase-chip">
              <span className="live-dot" />
              Scoring Live
            </div>
            <div className="context-title">
              {currentCountry ? `${currentCountry.flag} ${currentCountry.name}` : 'Waiting for country'}
            </div>
            <div className="context-meta">Country {progressLabel}</div>
          </div>
        </div>

        <div className="topbar-tools">
          <div className="profile-chip">
            <span>{me?.first_name}</span>
            <small>{me?.is_admin ? 'Leader' : 'Player'}</small>
          </div>
          <button className="icon-btn" onClick={requestFullscreen}>⛶ Fullscreen</button>
          {user?.is_admin && <button className="icon-btn" onClick={() => setShowAdmin(true)}>⚙ Admin</button>}
        </div>
      </header>

      {statusText && <div className="status-banner">{statusText}</div>}

      <main className="app-content">
        <div className="screen-grid">
          <section className="hero-panel scoring-panel scoring-enter">
            {hasSubmitted ? (
              <div className="submitted-confirmation fade-up">
                <div className="submitted-icon pop-in">✅</div>
                <h2>Scores Submitted!</h2>
                <p className="muted">Your score of <strong>{total}</strong> points has been locked in.</p>
                {allSubmitted ? (
                  <div className="all-submitted-banner fade-up" style={{ animationDelay: '200ms' }}>
                    <span>🎉</span> Everyone has voted — waiting for results
                  </div>
                ) : (
                  <p className="muted">Waiting for other players to finish voting…</p>
                )}
              </div>
            ) : (
            <>
            <div className="panel-header-row">
              <div className="fade-up" style={{ animationDelay: '80ms' }}>
                <div className="section-tag">Scorecard</div>
                <h2>Rate this performance</h2>
                <p className="muted">Tap a score from 1 to 5 for each category.</p>
              </div>
              <div className="total-orb pop-in" style={{ animationDelay: '200ms' }}>
                <span>Your total</span>
                <strong>{total}</strong>
                <small className="muted">of 40</small>
              </div>
            </div>

            <div className="score-grid app-score-grid">
              {categories.map((category, catIndex) => (
                <div key={category} className="score-card-row score-row-enter" style={{ animationDelay: `${280 + catIndex * 70}ms` }}>
                  <div className="score-card-header">
                    <label>{category}</label>
                    <span className="score-value">{scores[category]}/10</span>
                  </div>
                  <div className="score-buttons eleven-up single-line-scores">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                      <button
                        key={value}
                        className={scores[category] === value ? 'score-btn active' : 'score-btn'}
                        onClick={() => setScores((prev) => ({ ...prev, [category]: value }))}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </>
            )}
          </section>

          <aside className="side-stack">
            <section className="side-panel fade-up" style={{ animationDelay: '400ms' }}>
              <div className="section-tag">Session</div>
              <h3>Players</h3>
              <ul className="plain-list compact-list">
                {users.map((u: any) => (
                  <li key={u.id}>
                    <span>{u.first_name}{u.is_admin ? ' ★' : ''}</span>
                    <strong>{u.totalSubmittedScore || 0}</strong>
                  </li>
                ))}
              </ul>
            </section>

            <section className="side-panel fade-up" style={{ animationDelay: '550ms' }}>
              <div className="section-tag">Favourite</div>
              <h3>Pick your winner</h3>
              <div className="favourite-list vertical-list">
                {countries.map((country: any) => (
                  <button
                    key={country.id}
                    className={favourite === country.name ? 'favourite-btn active full-width' : 'favourite-btn full-width'}
                    onClick={() => setFavourite(country.name)}
                  >
                    {country.flag} {country.name}
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

      <footer className="bottom-action-bar">
        <div className="bottom-summary">
          <div>
            <div className="section-tag">Now Scoring</div>
            <strong>{currentCountry ? `${currentCountry.flag} ${currentCountry.name}` : 'No country selected'}</strong>
          </div>
        </div>
        <div className="bottom-actions">
          {user?.is_admin && (
            <button className="secondary-btn compact-btn" onClick={() => moveCountry('next')}>
              Lock &amp; Show Results
            </button>
          )}
          {!hasSubmitted && (
            <button className="primary-btn compact-btn" onClick={submitScores} disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : `Submit Scores (${total})`}
            </button>
          )}
        </div>
      </footer>

      {showLeaderboard && (
        <div className="modal-backdrop" onClick={() => setShowLeaderboard(false)}>
          <div className="modal-card app-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="section-tag">Main Ranking</div>
                <h3>Leaderboard</h3>
              </div>
              <button className="modal-close" onClick={() => setShowLeaderboard(false)}>×</button>
            </div>
            <p className="muted">Combined total score from everyone for each country.</p>
            <ol className="leaderboard-list">
              {leaderboard.map((country: any, index: number) => (
                <li key={country.id} className={index === 0 ? 'lb-gold' : index === 1 ? 'lb-silver' : index === 2 ? 'lb-bronze' : ''}>
                  <span>{index + 1}. {country.flag} {country.name} <small className="muted">({country.submittedBy} voted)</small></span>
                  <strong>{country.totalScore}</strong>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {showAdmin && user?.is_admin && (
        <div className="modal-backdrop" onClick={() => setShowAdmin(false)}>
          <div className="modal-card app-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="section-tag">Leader Controls</div>
                <h3>Admin Controls</h3>
              </div>
              <button className="modal-close" onClick={() => setShowAdmin(false)}>×</button>
            </div>
            <p className="muted">Use the controls below to drive the room.</p>
            <div className="admin-actions-grid two-up">
              <button className="secondary-btn" onClick={() => moveCountry('previous')}>← Previous</button>
              <button className="secondary-btn" onClick={() => moveCountry('next')}>Show Results →</button>
              <button className="secondary-btn" onClick={simulateFinale}>Trigger Finale ✨</button>
              <button className="secondary-btn danger-btn" onClick={resetApp}>Reset Session</button>
            </div>
            <div className="current-country-banner">
              Scoring: {currentCountry ? `${currentCountry.flag} ${currentCountry.name}` : 'None'} — Country {progressLabel}
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
