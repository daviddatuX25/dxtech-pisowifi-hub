import type { IconNode } from 'lucide';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  CreditCard,
  DollarSign,
  ExternalLink,
  FileCheck,
  FileText,
  Gift,
  GraduationCap,
  HelpCircle,
  IdCard,
  Image as ImageIcon,
  Inbox,
  Info,
  Layers,
  Lock,
  LogOut,
  MapPin,
  Pencil,
  Radio,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  Timer,
  UploadCloud,
  User,
  Wifi,
  Wrench,
  X,
  Zap,
} from 'lucide';

export function icon(iconNode: IconNode, customClass = '', size = 18): string {
  const baseAttrs: Record<string, string | number> = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: `lucide ${customClass}`.trim(),
    'aria-hidden': 'true',
  };

  const children = iconNode
    .map(([childTag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${childTag} ${attrStr}></${childTag}>`;
    })
    .join('');

  const attrsStr = Object.entries(baseAttrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  return `<svg ${attrsStr}>${children}</svg>`;
}

export const Icons = {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  CreditCard,
  DollarSign,
  ExternalLink,
  FileCheck,
  FileText,
  Gift,
  GraduationCap,
  HelpCircle,
  IdCard,
  ImageIcon,
  Inbox,
  Info,
  Layers,
  Lock,
  LogOut,
  MapPin,
  Pencil,
  Radio,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  Timer,
  UploadCloud,
  User,
  Wifi,
  Wrench,
  X,
  Zap,
};
