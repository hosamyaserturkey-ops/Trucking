"use client";

import { useState } from "react";
import { formatMoney, parseMoney, toLatinDigits } from "@/lib/money";
import { FUEL_UNITS, fuelCost, isFuelUnit, type FuelUnit } from "@/lib/fuel";
import { Field, Input, Select } from "@/components/ui/form";

type Option = { id: string; label: string };

/** Last price per unit, keyed "station|unit|currency" ("*" for any station), as an input string. */
export type LastFuelPrices = Record<string, string>;

export type FuelQuantityInitial = {
  station_id?: string | null;
  qty_unit?: string;
  quantity?: string;
  unit_price?: string;
  currency?: string;
};

/**
 * Where the diesel came from and how much: station, unit (لتر/قلن/تنكة),
 * quantity, price per unit and currency, with the cost shown live. The price
 * per unit depends on the station, so the last price paid there for that unit
 * is filled in until the user types their own.
 */
export function FuelQuantityFields({
  stations,
  lastPrices,
  initial = {},
  onCurrencyChange,
  large = false,
}: {
  stations: Option[];
  lastPrices: LastFuelPrices;
  initial?: FuelQuantityInitial;
  onCurrencyChange?: (currency: string) => void;
  large?: boolean;
}) {
  const [stationId, setStationId] = useState(initial.station_id ?? "");
  const [unit, setUnit] = useState<FuelUnit>(isFuelUnit(initial.qty_unit ?? "") ? (initial.qty_unit as FuelUnit) : "liter");
  const [quantity, setQuantity] = useState(initial.quantity ?? "");
  const [price, setPrice] = useState(initial.unit_price ?? "");
  // A price typed (or loaded from the record) is kept; a suggested one follows the station and unit.
  const [priceTyped, setPriceTyped] = useState(Boolean(initial.unit_price));
  const [currency, setCurrency] = useState(initial.currency ?? "JOD");

  const labels = FUEL_UNITS[unit];
  const stationPrice = (s: string, u: FuelUnit, c: string) => (s ? lastPrices[`${s}|${u}|${c}`] : undefined);
  const suggest = (s: string, u: FuelUnit, c: string) => {
    if (!priceTyped) setPrice(stationPrice(s, u, c) ?? "");
  };
  const anyStationPrice = lastPrices[`*|${unit}|${currency}`];

  const priceMinor = parseMoney(price, currency);
  const qty = Number(toLatinDigits(quantity).replace(/[,\s]/g, ""));
  const cost = priceMinor !== null && priceMinor > 0n && qty > 0 ? fuelCost(qty, Number(priceMinor)) : null;

  let priceHint: string | undefined;
  if (!priceTyped && price && stationId) priceHint = `آخر ${labels.price} من هذه المحطة`;
  else if (!price && anyStationPrice) priceHint = `آخر ${labels.price} مسجّل: ${anyStationPrice}`;

  const text = large ? "text-lg" : "";
  return (
    <>
      <Field label="المحطة (من وين عبّى)" htmlFor="station_id">
        <Select
          id="station_id"
          name="station_id"
          value={stationId}
          onChange={(e) => {
            setStationId(e.target.value);
            suggest(e.target.value, unit, currency);
          }}
        >
          <option value="">—</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">التعبئة بـ</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(FUEL_UNITS) as FuelUnit[]).map((u) => (
            <label
              key={u}
              className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/30"
            >
              <input
                type="radio"
                name="qty_unit"
                value={u}
                checked={unit === u}
                onChange={() => {
                  setUnit(u);
                  suggest(stationId, u, currency);
                }}
                className="sr-only"
              />
              {FUEL_UNITS[u].name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label={labels.count} htmlFor="quantity">
          <Input
            id="quantity"
            name="quantity"
            inputMode="decimal"
            dir="ltr"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={text}
            required
          />
        </Field>
        <Field label={labels.price} htmlFor="unit_price" hint={priceHint}>
          <Input
            id="unit_price"
            name="unit_price"
            inputMode="decimal"
            dir="ltr"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setPriceTyped(e.target.value !== "");
            }}
            className={text}
            required
          />
        </Field>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-end gap-3">
        <Field label="العملة" htmlFor="currency">
          <Select
            id="currency"
            name="currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              suggest(stationId, unit, e.target.value);
              onCurrencyChange?.(e.target.value);
            }}
          >
            <option value="JOD">دينار</option>
            <option value="USD">دولار</option>
          </Select>
        </Field>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm" aria-live="polite">
          الكلفة: <span className="num text-base font-bold">{cost !== null ? formatMoney(cost, currency) : "—"}</span>
        </p>
      </div>
    </>
  );
}
