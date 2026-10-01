// Heavy chart/icon libraries, isolated so they land in a lazy-loaded chunk.
// charts.js pulls this in via dynamic import() the first time the dashboard
// draws — players who never open the admin view never download any of it.
import { Chart } from 'chart.js/auto';   // /auto registers every controller + scale
import {
  createIcons,
  // nav + actions
  LayoutDashboard, Users, ClipboardList, Brain, ArrowLeft, RefreshCw, Download, ChevronRight,
  // stat-card glyphs
  Gamepad2, Trophy, Timer, Ghost, Lightbulb, Hourglass, Skull, Smartphone, Target, Calendar, TrendingUp,
} from 'lucide';

// Only the icons we actually reference — keeps the lazy chunk small (tree-shaken).
const lucideIcons = {
  LayoutDashboard, Users, ClipboardList, Brain, ArrowLeft, RefreshCw, Download, ChevronRight,
  Gamepad2, Trophy, Timer, Ghost, Lightbulb, Hourglass, Skull, Smartphone, Target, Calendar, TrendingUp,
};

export { Chart, createIcons, lucideIcons };
