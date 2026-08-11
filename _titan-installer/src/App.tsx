import { useEffect } from 'react';
import { useWizard, type Screen } from './store/wizard-state';
import Welcome from './screens/Welcome';
import RolePicker from './screens/RolePicker';
import Onboarding from './screens/Onboarding';
import AtlassianSetup from './screens/AtlassianSetup';
import TelemetrySetup from './screens/TelemetrySetup';
import FigmaInfo from './screens/FigmaInfo';
import PrereqCheck from './screens/PrereqCheck';
import AdoPat from './screens/AdoPat';
import WorkspaceLocation from './screens/WorkspaceLocation';
import CloneRepos from './screens/CloneRepos';
import InstallProgress from './screens/InstallProgress';
import Done from './screens/Done';
import Dashboard from './screens/Dashboard';
import ConfigEditor from './screens/ConfigEditor';
import WizardChrome from './components/WizardChrome';

const screenMap: Record<Screen, () => JSX.Element> = {
  'welcome':            Welcome,
  'role-picker':        RolePicker,
  'onboarding':         Onboarding,
  'atlassian-setup':    AtlassianSetup,
  'telemetry-setup':    TelemetrySetup,
  'figma-info':         FigmaInfo,
  'prereq-check':       PrereqCheck,
  'ado-pat':            AdoPat,
  'workspace-location': WorkspaceLocation,
  'clone-repos':        CloneRepos,
  'install-progress':   InstallProgress,
  'done':               Done,
  'dashboard':          Dashboard,
  'config-editor':      ConfigEditor,
};

// Screens rendered without the wizard chrome (full-page, no stepper).
const CHROMELESS_SCREENS: Screen[] = ['dashboard', 'config-editor'];

export default function App(): JSX.Element {
  const currentScreen = useWizard((s) => s.currentScreen);
  const loadTitanConfig = useWizard((s) => s.loadTitanConfig);
  const ScreenComponent = screenMap[currentScreen];

  // Load titan.config.json once at startup — every config-driven screen
  // (RolePicker, CloneRepos, AtlassianSetup, TelemetrySetup, ConfigEditor)
  // reads it from wizard-state rather than each fetching it independently.
  useEffect(() => { void loadTitanConfig(); }, [loadTitanConfig]);

  if (CHROMELESS_SCREENS.includes(currentScreen)) {
    return <ScreenComponent />;
  }

  return (
    <WizardChrome>
      <ScreenComponent />
    </WizardChrome>
  );
}
