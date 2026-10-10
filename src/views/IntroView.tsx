import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Download, Globe2, Sparkles, WandSparkles } from 'lucide-react';
import introWorldArt from '../assets/auth-world.svg';

interface IntroViewProps {
  username: string;
  javaReady: boolean;
  onContinue: () => Promise<void>;
}

export const IntroView: React.FC<IntroViewProps> = ({ username, javaReady, onContinue }) => {
  const [step, setStep] = useState(0);
  const lastStep = step === 3;

  return (
    <div className="startup-screen intro-screen">
      <div className="intro-panel animate-fade-in">
        <img className="intro-panel-art" src={introWorldArt} alt="" aria-hidden="true" draggable={false} />
        <div className="intro-progress-header">
          <div className="intro-kicker"><Sparkles size={15} /> SETTING UP YOUR LAUNCHER</div>
          <span>{step + 1} / 4</span>
        </div>
        <div className="intro-step-dots" aria-label={`Introduction step ${step + 1} of 4`}>
          {[0, 1, 2, 3].map((item) => <span key={item} className={item <= step ? 'active' : ''} />)}
        </div>

        <div key={step} className="intro-step-content">
          {step === 0 && <>
            <h1>Welcome, {username}.</h1>
            <p className="auth-copy">A focused launcher for clean instances, smooth setup, and a little more personality in multiplayer.</p>
            <div className="intro-grid"><div className="intro-feature"><span className="intro-icon"><Sparkles size={18} /></span><div><strong>Your launcher, your rhythm</strong><small>We will take you through the important parts before the home screen.</small></div></div></div>
          </>}
          {step === 1 && <>
            <h1>Ready for modded worlds.</h1>
            <p className="auth-copy">New instances are Fabric-first and the required runtime is prepared quietly in the background.</p>
            <div className="intro-grid"><div className="intro-feature"><span className="intro-icon"><WandSparkles size={18} /></span><div><strong>Fabric-first play</strong><small>Build every instance around the mods you actually use.</small></div></div><div className="intro-feature"><span className="intro-icon"><Download size={18} /></span><div><strong>Runtime handled quietly</strong><small>{javaReady ? 'Java is ready for the launcher.' : 'Java 25 is being prepared in the background.'}</small></div></div></div>
          </>}
          {step === 2 && <>
            <h1>Find your next server.</h1>
            <p className="auth-copy">Your Overview brings featured servers, live player activity, announcements, and network updates into one quiet place.</p>
            <div className="intro-grid"><div className="intro-feature"><span className="intro-icon"><Globe2 size={18} /></span><div><strong>Featured servers, kept fresh</strong><small>Server icons and status information refresh automatically from the network.</small></div></div><div className="intro-feature"><span className="intro-icon"><Compass size={18} /></span><div><strong>Explore the launcher</strong><small>Browse Instances, Content Hub, Accounts, and Settings whenever you are ready.</small></div></div></div>
          </>}
          {step === 3 && <>
            <h1>Make your profile yours.</h1>
            <p className="auth-copy">You can add a skin, cape, badge, and accent color later. DewClient players will see your shared cosmetics when you are online.</p>
            <div className="intro-grid"><div className="intro-feature"><span className="intro-icon"><Sparkles size={18} /></span><div><strong>Cosmetics are optional</strong><small>Open Accounts after setup whenever you want to personalize your profile.</small></div></div></div>
          </>}
        </div>

        <div className="intro-actions">
          {step > 0 ? <button className="btn btn-secondary" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={16} /> Back</button> : <span />}
          <div className="intro-action-right">
            {!lastStep && <button className="auth-secondary-action intro-skip" onClick={onContinue}>Skip intro</button>}
            {lastStep ? <button className="btn btn-primary btn-lg" onClick={onContinue}><Check size={18} /> Enter DewClient</button> : <button className="btn btn-primary btn-lg" onClick={() => setStep((current) => current + 1)}>Next <ArrowRight size={16} /></button>}
          </div>
        </div>
      </div>
    </div>
  );
};
