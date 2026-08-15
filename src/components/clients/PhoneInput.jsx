import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronDown } from 'lucide-react';

const COUNTRIES = [
  { code: 'LB', name: 'Lebanon', dial: '+961', flag: 'ðŸ‡±ðŸ‡§' },
  { code: 'US', name: 'United States', dial: '+1', flag: 'ðŸ‡ºðŸ‡¸' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: 'ðŸ‡¬ðŸ‡§' },
  { code: 'FR', name: 'France', dial: '+33', flag: 'ðŸ‡«ðŸ‡·' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: 'ðŸ‡©ðŸ‡ª' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: 'ðŸ‡¸ðŸ‡¦' },
  { code: 'AE', name: 'UAE', dial: '+971', flag: 'ðŸ‡¦ðŸ‡ª' },
  { code: 'EG', name: 'Egypt', dial: '+20', flag: 'ðŸ‡ªðŸ‡¬' },
  { code: 'JO', name: 'Jordan', dial: '+962', flag: 'ðŸ‡¯ðŸ‡´' },
  { code: 'KW', name: 'Kuwait', dial: '+965', flag: 'ðŸ‡°ðŸ‡¼' },
  { code: 'QA', name: 'Qatar', dial: '+974', flag: 'ðŸ‡¶ðŸ‡¦' },
  { code: 'BH', name: 'Bahrain', dial: '+973', flag: 'ðŸ‡§ðŸ‡­' },
  { code: 'OM', name: 'Oman', dial: '+968', flag: 'ðŸ‡´ðŸ‡²' },
  { code: 'IQ', name: 'Iraq', dial: '+964', flag: 'ðŸ‡®ðŸ‡¶' },
  { code: 'SY', name: 'Syria', dial: '+963', flag: 'ðŸ‡¸ðŸ‡¾' },
  { code: 'TR', name: 'Turkey', dial: '+90', flag: 'ðŸ‡¹ðŸ‡·' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: 'ðŸ‡¨ðŸ‡¦' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: 'ðŸ‡¦ðŸ‡º' },
  { code: 'IT', name: 'Italy', dial: '+39', flag: 'ðŸ‡®ðŸ‡¹' },
  { code: 'ES', name: 'Spain', dial: '+34', flag: 'ðŸ‡ªðŸ‡¸' },
  { code: 'SE', name: 'Sweden', dial: '+46', flag: 'ðŸ‡¸ðŸ‡ª' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: 'ðŸ‡§ðŸ‡·' },
  { code: 'IN', name: 'India', dial: '+91', flag: 'ðŸ‡®ðŸ‡³' },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: 'ðŸ‡³ðŸ‡¬' },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: 'ðŸ‡¿ðŸ‡¦' },
];

export function parsePhoneValue(fullNumber) {
  if (!fullNumber) return { country: COUNTRIES[0], local: '' };
  for (const c of [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)) {
    if (fullNumber.startsWith(c.dial)) {
      return { country: c, local: fullNumber.slice(c.dial.length).trim() };
    }
  }
  return { country: COUNTRIES[0], local: fullNumber };
}

export default function PhoneInput({ value, onChange, placeholder = '71 234 567' }) {
  const parsed = parsePhoneValue(value);
  const [country, setCountry] = useState(parsed.country);
  const [local, setLocal] = useState(parsed.local);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCountrySelect = (c) => {
    setCountry(c);
    setOpen(false);
    setSearch('');
    onChange(`${c.dial}${local}`);
  };

  const handleLocalChange = (e) => {
    const digits = e.target.value.replace(/[^\d\s\-]/g, '');
    setLocal(digits);
    onChange(`${country.dial}${digits}`);
  };

  const filtered = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.dial.includes(search) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex gap-0 relative" ref={dropRef}>
      {/* Country picker button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-3 h-9 rounded-l-md border border-r-0 border-input bg-muted hover:bg-accent transition-colors text-sm font-medium shrink-0"
      >
        <span className="text-base">{country.flag}</span>
        <span className="text-xs text-muted-foreground">{country.dial}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>

      {/* Number input */}
      <Input
        value={local}
        onChange={handleLocalChange}
        placeholder={placeholder}
        className="rounded-l-none border-l-0"
      />

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search country..."
              className="h-7 text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map(c => (
              <button
                key={c.code}
                type="button"
                onClick={() => handleCountrySelect(c)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-sm text-left transition-colors"
              >
                <span className="text-base">{c.flag}</span>
                <span className="text-muted-foreground text-xs w-10 shrink-0">{c.dial}</span>
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
