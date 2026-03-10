"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, MapPin, Check, ChevronRight } from "lucide-react";
import type { OsmUser } from "@/lib/store";
import OpeningHoursEditor from "@/components/opening-hours-editor";

// ---------------------------------------------------------------------------
// POI Templates
// ---------------------------------------------------------------------------
interface PoiTemplate {
  id: string;
  icon: string;
  labelEn: string;
  labelCs: string;
  baseTags: Record<string, string>;
  /** Fields the user fills in. name is always optional. */
  extraFields?: ExtraField[];
}

interface ExtraField {
  key: string;
  type: "text" | "select" | "opening_hours";
  labelEn: string;
  labelCs: string;
  required?: boolean;
  options?: { value: string; labelEn: string; labelCs: string }[];
}

const POI_TEMPLATES: PoiTemplate[] = [
  {
    id: "bench",
    icon: "🪑",
    labelEn: "Bench",
    labelCs: "Lavička",
    baseTags: { amenity: "bench" },
    extraFields: [
      {
        key: "backrest",
        type: "select",
        labelEn: "Backrest",
        labelCs: "Opěradlo",
        options: [
          { value: "yes", labelEn: "Yes", labelCs: "Ano" },
          { value: "no", labelEn: "No", labelCs: "Ne" },
        ],
      },
    ],
  },
  {
    id: "waste_basket",
    icon: "🗑️",
    labelEn: "Waste Basket",
    labelCs: "Odpadkový koš",
    baseTags: { amenity: "waste_basket" },
  },
  {
    id: "bicycle_parking",
    icon: "🚲",
    labelEn: "Bicycle Parking",
    labelCs: "Cyklostojiště",
    baseTags: { amenity: "bicycle_parking" },
    extraFields: [
      {
        key: "bicycle_parking",
        type: "select",
        labelEn: "Type",
        labelCs: "Typ",
        options: [
          { value: "stands", labelEn: "Stands (U-lock)", labelCs: "Kolostavy (U-zámek)" },
          { value: "wall_loops", labelEn: "Wall loops", labelCs: "Nástěnné smyčky" },
          { value: "rack", labelEn: "Rack", labelCs: "Stojan" },
          { value: "lockers", labelEn: "Lockers", labelCs: "Uzamykatelné boxy" },
          { value: "shed", labelEn: "Shed", labelCs: "Kryté stání" },
        ],
      },
      {
        key: "capacity",
        type: "text",
        labelEn: "Capacity",
        labelCs: "Kapacita",
      },
    ],
  },
  {
    id: "drinking_water",
    icon: "💧",
    labelEn: "Drinking Water",
    labelCs: "Pitná voda",
    baseTags: { amenity: "drinking_water" },
  },
  {
    id: "toilets",
    icon: "🚽",
    labelEn: "Public Toilets",
    labelCs: "Veřejné WC",
    baseTags: { amenity: "toilets" },
    extraFields: [
      {
        key: "access",
        type: "select",
        labelEn: "Access",
        labelCs: "Přístup",
        options: [
          { value: "yes", labelEn: "Public", labelCs: "Veřejné" },
          { value: "customers", labelEn: "Customers only", labelCs: "Pouze zákazníci" },
        ],
      },
      {
        key: "fee",
        type: "select",
        labelEn: "Fee",
        labelCs: "Poplatek",
        options: [
          { value: "no", labelEn: "Free", labelCs: "Zdarma" },
          { value: "yes", labelEn: "Paid", labelCs: "Placené" },
        ],
      },
      {
        key: "opening_hours",
        type: "opening_hours",
        labelEn: "Opening Hours",
        labelCs: "Otevírací doba",
      },
    ],
  },
  {
    id: "recycling",
    icon: "♻️",
    labelEn: "Recycling",
    labelCs: "Recyklace",
    baseTags: { amenity: "recycling", recycling_type: "container" },
  },
  {
    id: "post_box",
    icon: "📮",
    labelEn: "Post Box",
    labelCs: "Poštovní schránka",
    baseTags: { amenity: "post_box" },
  },
  {
    id: "cafe",
    icon: "☕",
    labelEn: "Café",
    labelCs: "Kavárna",
    baseTags: { amenity: "cafe" },
    extraFields: [
      {
        key: "name",
        type: "text",
        labelEn: "Name",
        labelCs: "Název",
        required: true,
      },
      {
        key: "opening_hours",
        type: "opening_hours",
        labelEn: "Opening Hours",
        labelCs: "Otevírací doba",
      },
      {
        key: "internet_access",
        type: "select",
        labelEn: "WiFi",
        labelCs: "WiFi",
        options: [
          { value: "wlan", labelEn: "Free WiFi", labelCs: "WiFi zdarma" },
          { value: "no", labelEn: "No WiFi", labelCs: "Bez WiFi" },
        ],
      },
    ],
  },
  {
    id: "restaurant",
    icon: "🍽️",
    labelEn: "Restaurant",
    labelCs: "Restaurace",
    baseTags: { amenity: "restaurant" },
    extraFields: [
      {
        key: "name",
        type: "text",
        labelEn: "Name",
        labelCs: "Název",
        required: true,
      },
      {
        key: "opening_hours",
        type: "opening_hours",
        labelEn: "Opening Hours",
        labelCs: "Otevírací doba",
      },
    ],
  },
  {
    id: "shop_convenience",
    icon: "🛒",
    labelEn: "Convenience Store",
    labelCs: "Samoobsluha",
    baseTags: { shop: "convenience" },
    extraFields: [
      {
        key: "name",
        type: "text",
        labelEn: "Name",
        labelCs: "Název",
        required: true,
      },
      {
        key: "opening_hours",
        type: "opening_hours",
        labelEn: "Opening Hours",
        labelCs: "Otevírací doba",
      },
    ],
  },
  {
    id: "atm",
    icon: "🏧",
    labelEn: "ATM",
    labelCs: "Bankomat",
    baseTags: { amenity: "atm" },
    extraFields: [
      {
        key: "operator",
        type: "text",
        labelEn: "Bank / Operator",
        labelCs: "Banka / Provozovatel",
      },
    ],
  },
  {
    id: "charging_station",
    icon: "⚡",
    labelEn: "EV Charging Station",
    labelCs: "Dobíjecí stanice EV",
    baseTags: { amenity: "charging_station" },
  },
  {
    id: "bus_stop",
    icon: "🚌",
    labelEn: "Bus Stop",
    labelCs: "Autobusová zastávka",
    baseTags: { highway: "bus_stop", public_transport: "stop_position" },
    extraFields: [
      {
        key: "name",
        type: "text",
        labelEn: "Name",
        labelCs: "Název",
        required: true,
      },
      {
        key: "shelter",
        type: "select",
        labelEn: "Shelter",
        labelCs: "Přístřešek",
        options: [
          { value: "yes", labelEn: "Yes", labelCs: "Ano" },
          { value: "no", labelEn: "No", labelCs: "Ne" },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AddPoiDialogProps {
  open: boolean;
  lat: number;
  lon: number;
  locale: Locale;
  user: OsmUser | null;
  onClose: () => void;
  onAdded: () => void;
}

export default function AddPoiDialog({ open, lat, lon, locale, user, onClose, onAdded }: AddPoiDialogProps) {
  const cs = locale === "cs";
  const [step, setStep] = useState<"choose" | "configure">("choose");
  const [selectedTemplate, setSelectedTemplate] = useState<PoiTemplate | null>(null);
  const [name, setName] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const resetState = () => {
    setStep("choose");
    setSelectedTemplate(null);
    setName("");
    setExtraValues({});
    setSubmitting(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleChooseTemplate = (tpl: PoiTemplate) => {
    setSelectedTemplate(tpl);
    setExtraValues({});
    setName("");
    setStep("configure");
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error(cs ? "Musíte být přihlášeni" : "You must be logged in to add places");
      return;
    }
    if (!selectedTemplate) return;

    // Validate required extra fields
    const missing = (selectedTemplate.extraFields || []).filter(
      (f) => f.required && f.key !== "name" && !extraValues[f.key]?.trim()
    );
    // name field is handled separately
    const nameField = (selectedTemplate.extraFields || []).find((f) => f.key === "name");
    if (nameField?.required && !name.trim()) {
      toast.error(cs ? "Vyplňte prosím název" : "Please enter the name");
      return;
    }
    if (missing.length > 0) {
      toast.error(cs ? "Vyplňte prosím všechna povinná pole" : "Please fill all required fields");
      return;
    }

    setSubmitting(true);
    try {
      const tags: Record<string, string> = { ...selectedTemplate.baseTags };
      if (name.trim()) tags["name"] = name.trim();
      for (const [k, v] of Object.entries(extraValues)) {
        if (v && v.trim() && k !== "name") tags[k] = v.trim();
      }

      const poiLabel = cs ? selectedTemplate.labelCs : selectedTemplate.labelEn;
      const comment = name.trim()
        ? `Add ${poiLabel}: ${name.trim()} via GeoComplete`
        : `Add ${poiLabel} via GeoComplete`;

      const res = await fetch("/api/osm/poi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon, tags, comment }),
      });

      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }

      toast.success(cs ? "Místo přidáno do OSM!" : "Place added to OSM!");
      resetState();
      onAdded();
    } catch (err) {
      console.error("POI submit error:", err);
      toast.error(cs ? "Chyba při odesílání" : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin size={16} className="text-primary shrink-0" />
            {step === "choose"
              ? (cs ? "Vyberte typ místa" : "Choose place type")
              : (cs ? selectedTemplate?.labelCs : selectedTemplate?.labelEn)}
          </DialogTitle>
          {step === "configure" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {lat.toFixed(6)}, {lon.toFixed(6)}
            </p>
          )}
        </DialogHeader>

        {step === "choose" && (
          <ScrollArea className="h-[420px]">
            <div className="grid grid-cols-2 gap-2 p-4">
              {POI_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleChooseTemplate(tpl)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-3 hover:border-primary/60 hover:bg-primary/5 transition-all text-center"
                >
                  <span className="text-2xl leading-none" aria-hidden="true">{tpl.icon}</span>
                  <span className="text-xs font-medium text-foreground leading-tight">
                    {cs ? tpl.labelCs : tpl.labelEn}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}

        {step === "configure" && selectedTemplate && (
          <ScrollArea className="h-[420px]">
            <div className="flex flex-col gap-4 p-4">
              {/* Name field (if template doesn't have it as required extra) */}
              {!(selectedTemplate.extraFields || []).some((f) => f.key === "name") && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {cs ? "Název (nepovinné)" : "Name (optional)"}
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={cs ? "např. Lavička u parku" : "e.g. Bench near park"}
                    className="h-9 text-sm"
                  />
                </div>
              )}

              {/* Extra fields */}
              {(selectedTemplate.extraFields || []).map((field) => {
                if (field.key === "name") {
                  return (
                    <div key={field.key} className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-foreground">
                        {cs ? field.labelCs : field.labelEn}
                        {field.required && <span className="text-destructive ml-0.5">*</span>}
                      </label>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={cs ? "Zadejte název..." : "Enter name..."}
                        className="h-9 text-sm"
                      />
                    </div>
                  );
                }

                if (field.type === "opening_hours") {
                  return (
                    <div key={field.key} className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-foreground">
                        {cs ? field.labelCs : field.labelEn}
                      </label>
                      <OpeningHoursEditor
                        value={extraValues[field.key] || ""}
                        onChange={(v) => setExtraValues((prev) => ({ ...prev, [field.key]: v }))}
                        locale={locale}
                      />
                    </div>
                  );
                }

                if (field.type === "select" && field.options) {
                  return (
                    <div key={field.key} className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-foreground">
                        {cs ? field.labelCs : field.labelEn}
                        {field.required && <span className="text-destructive ml-0.5">*</span>}
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        {field.options.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              setExtraValues((prev) => ({
                                ...prev,
                                [field.key]: prev[field.key] === opt.value ? "" : opt.value,
                              }))
                            }
                            className={`flex-1 min-w-[80px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                              extraValues[field.key] === opt.value
                                ? "bg-primary border-primary text-primary-foreground"
                                : "bg-card border-border text-foreground hover:border-primary/50"
                            }`}
                          >
                            {cs ? opt.labelCs : opt.labelEn}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }

                // text
                return (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {cs ? field.labelCs : field.labelEn}
                      {field.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    <Input
                      value={extraValues[field.key] || ""}
                      onChange={(e) =>
                        setExtraValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={cs ? "Zadejte hodnotu..." : "Enter value..."}
                      className="h-9 text-sm"
                    />
                  </div>
                );
              })}

              {/* Base tags preview */}
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  OSM Tags
                </p>
                {Object.entries(selectedTemplate.baseTags).map(([k, v]) => (
                  <div key={k} className="flex gap-1 text-[11px] font-mono">
                    <span className="text-muted-foreground">{k}=</span>
                    <span className="text-foreground">{v}</span>
                  </div>
                ))}
              </div>

              {!user && (
                <p className="text-xs text-destructive text-center">
                  {cs ? "Pro přidávání míst musíte být přihlášeni" : "You must be logged in to add places"}
                </p>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-card">
          {step === "choose" ? (
            <Button variant="outline" size="sm" className="flex-1" onClick={handleClose}>
              {cs ? "Zrušit" : "Cancel"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setStep("choose")}
                disabled={submitting}
              >
                {cs ? "Zpět" : "Back"}
              </Button>
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                onClick={handleSubmit}
                disabled={submitting || !user}
              >
                {submitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                {cs ? "Přidat do OSM" : "Add to OSM"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
