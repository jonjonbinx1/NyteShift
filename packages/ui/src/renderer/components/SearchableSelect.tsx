import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";

export interface SearchOption {
  value: string;
  label?: string;
  title?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  allowFreeInput = false,
}: {
  value?: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
  allowFreeInput?: boolean;
}): React.JSX.Element {
  const { palette: C } = useTheme();

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "6px 8px", background: C.mantle,
    border: `1px solid ${C.surface2}`, borderRadius: 6,
    color: C.text, fontSize: "0.8rem", outline: "none", boxSizing: "border-box",
  };

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!(e.target instanceof Node)) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = options.find(o => o.value === (value ?? ""));
  const displayValue = open ? filter : (selected ? (selected.label ?? selected.value) : (value ?? ""));

  const list = options.filter(o => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return ((o.label ?? o.value).toLowerCase().includes(f));
  });

  const onInputFocus = () => {
    setOpen(true);
    setFilter(allowFreeInput ? (value ?? "") : "");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setFilter(v);
    setOpen(true);
    if (allowFreeInput) onChange(v);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setOpen(false);
    if (e.key === "Enter") {
      if (allowFreeInput) {
        onChange(filter);
        setOpen(false);
        setFilter("");
      } else {
        if (list.length > 0) {
          onChange(list[0].value);
          setOpen(false);
          setFilter("");
        }
      }
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        style={inputStyle}
        value={displayValue}
        placeholder={placeholder}
        onFocus={onInputFocus}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div style={{
          position: "absolute", left: 0, right: 0, zIndex: 1200,
          background: C.mantle, border: `1px solid ${C.surface2}`, borderRadius: 6,
          marginTop: 6, maxHeight: 260, overflowY: "auto", boxShadow: "0 6px 18px rgba(0,0,0,0.18)"
        }}>
          {list.length === 0 ? (
            <div style={{ padding: 8, color: C.overlay0 }}>No matches</div>
          ) : (
            list.map(opt => (
              <div
                key={opt.value || opt.label}
                onClick={() => { onChange(opt.value); setOpen(false); setFilter(""); }}
                title={opt.title ?? opt.label ?? opt.value}
                style={{ padding: 8, cursor: "pointer", borderBottom: `1px solid ${C.surface1}`, color: C.text }}>
                {opt.label ?? opt.value}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
