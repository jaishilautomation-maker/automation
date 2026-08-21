"use client";

export interface BatchEntry {
  id: string;
  from: string;
  to: string;
  material: string;
  calcifier: string;
  blowerIn: string;
  blowerOut: string;
  work: string;
}

interface Props {
  batch: BatchEntry;
  index: number;
  onRemove: (id: string) => void;
  onChange: (id: string, field: keyof BatchEntry, value: string) => void;
}

export default function BatchEntryBlock({ batch, index, onRemove, onChange }: Props) {
  return (
    <div className="batch-block">
      <button
        className="batch-remove"
        type="button"
        onClick={() => onRemove(batch.id)}
      >
        हटाएं
      </button>
      <span className="batch-label">बैच एन्ट्री {index + 1}</span>

      <div className="row2">
        <div>
          <label>से (समय)</label>
          <input
            type="time"
            value={batch.from}
            onChange={e => onChange(batch.id, "from", e.target.value)}
          />
        </div>
        <div>
          <label>तक (समय)</label>
          <input
            type="time"
            value={batch.to}
            onChange={e => onChange(batch.id, "to", e.target.value)}
          />
        </div>
      </div>

      <label>माल का कोड नंबर</label>
      <input
        type="text"
        placeholder="माल का कोड नंबर"
        value={batch.material}
        onChange={e => onChange(batch.id, "material", e.target.value)}
      />

      <div className="row3">
        <div>
          <label>कॅल्सिफायर वि एफ डि</label>
          <input
            type="text"
            value={batch.calcifier}
            onChange={e => onChange(batch.id, "calcifier", e.target.value)}
          />
        </div>
        <div>
          <label>ब्लोवर इनलेट वाल्व</label>
          <input
            type="text"
            value={batch.blowerIn}
            onChange={e => onChange(batch.id, "blowerIn", e.target.value)}
          />
        </div>
        <div>
          <label>ब्लोवर आउटलेट वाल्व</label>
          <input
            type="text"
            value={batch.blowerOut}
            onChange={e => onChange(batch.id, "blowerOut", e.target.value)}
          />
        </div>
      </div>

      <label>काम का विवरण</label>
      <textarea
        value={batch.work}
        onChange={e => onChange(batch.id, "work", e.target.value)}
      />
    </div>
  );
}
