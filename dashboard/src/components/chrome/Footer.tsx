import { DISCLAIMER } from '../../lib/pricing';

export default function Footer() {
  return (
    <footer className="max-w-7xl mx-auto px-6 py-6 mt-4 border-t border-titan-gray-light text-xs text-titan-gray-mid text-center">
      <p className="mb-1">{DISCLAIMER}</p>
      <p>Titan Analytics v1.0 · contact your toolkit maintainer (see titan.config.json → contacts.people)</p>
    </footer>
  );
}
