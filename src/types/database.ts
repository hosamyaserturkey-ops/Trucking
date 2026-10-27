export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_postable: boolean
          name_ar: string
          parent_id: string | null
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_postable?: boolean
          name_ar: string
          parent_id?: string | null
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_postable?: boolean
          name_ar?: string
          parent_id?: string | null
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_receipts: {
        Row: {
          amount_minor: number
          cheque_bank: string | null
          cheque_due_date: string | null
          cheque_no: string | null
          cheque_status: string | null
          cheque_status_on: string | null
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          method: string
          notes: string | null
          receipt_no: number
          received_on: string
          reference_no: string | null
          updated_at: string
        }
        Insert: {
          amount_minor: number
          cheque_bank?: string | null
          cheque_due_date?: string | null
          cheque_no?: string | null
          cheque_status?: string | null
          cheque_status_on?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          method: string
          notes?: string | null
          receipt_no?: never
          received_on: string
          reference_no?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          cheque_bank?: string | null
          cheque_due_date?: string | null
          cheque_no?: string | null
          cheque_status?: string | null
          cheque_status_on?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          notes?: string | null
          receipt_no?: never
          received_on?: string
          reference_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_balance_v"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          city: string | null
          client_no: number
          created_at: string
          created_by: string | null
          credit_limit_base_minor: number | null
          default_currency: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_terms_days: number
          phone: string | null
          ref_code: string | null
          tax_number: string | null
          updated_at: string
          vat_exempt: boolean
        }
        Insert: {
          address?: string | null
          city?: string | null
          client_no?: never
          created_at?: string
          created_by?: string | null
          credit_limit_base_minor?: number | null
          default_currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          ref_code?: string | null
          tax_number?: string | null
          updated_at?: string
          vat_exempt?: boolean
        }
        Update: {
          address?: string | null
          city?: string | null
          client_no?: never
          created_at?: string
          created_by?: string | null
          credit_limit_base_minor?: number | null
          default_currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          ref_code?: string | null
          tax_number?: string | null
          updated_at?: string
          vat_exempt?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clients_default_currency_fkey"
            columns: ["default_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      company_settings: {
        Row: {
          address: string | null
          base_currency: string
          company_name: string
          fuel_anomaly_threshold_pct: number
          id: boolean
          overhead_allocation: string
          phone: string | null
          tax_number: string | null
          timezone: string
          updated_at: string
          vat_rate_pct: number
        }
        Insert: {
          address?: string | null
          base_currency?: string
          company_name?: string
          fuel_anomaly_threshold_pct?: number
          id?: boolean
          overhead_allocation?: string
          phone?: string | null
          tax_number?: string | null
          timezone?: string
          updated_at?: string
          vat_rate_pct?: number
        }
        Update: {
          address?: string | null
          base_currency?: string
          company_name?: string
          fuel_anomaly_threshold_pct?: number
          id?: boolean
          overhead_allocation?: string
          phone?: string | null
          tax_number?: string | null
          timezone?: string
          updated_at?: string
          vat_rate_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          minor_units: number
          name_ar: string
          rate_to_base: number | null
        }
        Insert: {
          code: string
          minor_units: number
          name_ar: string
          rate_to_base?: number | null
        }
        Update: {
          code?: string
          minor_units?: number
          name_ar?: string
          rate_to_base?: number | null
        }
        Relationships: []
      }
      driver_advances: {
        Row: {
          amount_base_minor: number
          amount_minor: number
          created_at: string
          created_by: string | null
          currency: string
          driver_id: string
          fx_rate: number
          id: string
          issued_on: string
          method: string
          notes: string | null
          settlement_id: string | null
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          amount_base_minor?: number
          amount_minor: number
          created_at?: string
          created_by?: string | null
          currency?: string
          driver_id: string
          fx_rate?: number
          id?: string
          issued_on: string
          method?: string
          notes?: string | null
          settlement_id?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_base_minor?: number
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          driver_id?: string
          fx_rate?: number
          id?: string
          issued_on?: string
          method?: string
          notes?: string | null
          settlement_id?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_advances_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "driver_advances_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_advances_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_advances_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_advances_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_profit_v"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "driver_advances_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_advances_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["current_trip_id"]
          },
        ]
      }
      driver_settlements: {
        Row: {
          advances_base_minor: number
          advances_count: number
          created_at: string
          created_by: string | null
          difference_base_minor: number
          driver_id: string
          expenses_base_minor: number
          expenses_count: number
          fuel_base_minor: number
          fuel_count: number
          id: string
          notes: string | null
          settled_on: string
          settlement_no: number
        }
        Insert: {
          advances_base_minor: number
          advances_count?: number
          created_at?: string
          created_by?: string | null
          difference_base_minor: number
          driver_id: string
          expenses_base_minor: number
          expenses_count?: number
          fuel_base_minor?: number
          fuel_count?: number
          id?: string
          notes?: string | null
          settled_on: string
          settlement_no?: never
        }
        Update: {
          advances_base_minor?: number
          advances_count?: number
          created_at?: string
          created_by?: string | null
          difference_base_minor?: number
          driver_id?: string
          expenses_base_minor?: number
          expenses_count?: number
          fuel_base_minor?: number
          fuel_count?: number
          id?: string
          notes?: string | null
          settled_on?: string
          settlement_no?: never
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          created_at: string
          created_by: string | null
          default_truck_id: string | null
          full_name: string
          hire_date: string | null
          id: string
          is_active: boolean
          license_expiry: string | null
          license_number: string | null
          national_id: string | null
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_truck_id?: string | null
          full_name: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          license_expiry?: string | null
          license_number?: string | null
          national_id?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_truck_id?: string | null
          full_name?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          license_expiry?: string | null
          license_number?: string | null
          national_id?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_default_truck_id_fkey"
            columns: ["default_truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "drivers_default_truck_id_fkey"
            columns: ["default_truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          account_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_base_minor: number
          amount_minor: number
          category_id: string
          cost_scope: string
          created_at: string
          created_by: string | null
          currency: string
          description: string
          driver_id: string | null
          expense_date: string
          fx_rate: number
          id: string
          payment_method: string
          receipt_path: string | null
          reference_no: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          settlement_id: string | null
          status: string
          submitted_by: string | null
          supplier_id: string | null
          trip_id: string | null
          truck_id: string | null
          updated_at: string
        }
        Insert: {
          amount_base_minor?: number
          amount_minor: number
          category_id: string
          cost_scope?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          driver_id?: string | null
          expense_date: string
          fx_rate?: number
          id?: string
          payment_method?: string
          receipt_path?: string | null
          reference_no?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_id?: string | null
          status?: string
          submitted_by?: string | null
          supplier_id?: string | null
          trip_id?: string | null
          truck_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_base_minor?: number
          amount_minor?: number
          category_id?: string
          cost_scope?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          driver_id?: string | null
          expense_date?: string
          fx_rate?: number
          id?: string
          payment_method?: string
          receipt_path?: string | null
          reference_no?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_id?: string | null
          status?: string
          submitted_by?: string | null
          supplier_id?: string | null
          trip_id?: string | null
          truck_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expenses_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "expenses_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_settlement_fk"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_profit_v"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["current_trip_id"]
          },
          {
            foreignKeyName: "expenses_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "expenses_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_installments: {
        Row: {
          amount_base_minor: number
          created_at: string
          due_date: string
          financing_id: string
          id: string
          installment_no: number
          interest_base_minor: number
          paid_amount_base_minor: number | null
          paid_on: string | null
          principal_base_minor: number
          updated_at: string
        }
        Insert: {
          amount_base_minor: number
          created_at?: string
          due_date: string
          financing_id: string
          id?: string
          installment_no: number
          interest_base_minor: number
          paid_amount_base_minor?: number | null
          paid_on?: string | null
          principal_base_minor: number
          updated_at?: string
        }
        Update: {
          amount_base_minor?: number
          created_at?: string
          due_date?: string
          financing_id?: string
          id?: string
          installment_no?: number
          interest_base_minor?: number
          paid_amount_base_minor?: number | null
          paid_on?: string | null
          principal_base_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_installments_financing_id_fkey"
            columns: ["financing_id"]
            isOneToOne: false
            referencedRelation: "truck_financing"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_fillups: {
        Row: {
          amount_base_minor: number
          amount_minor: number
          created_at: string
          created_by: string | null
          currency: string
          driver_id: string | null
          filled_at: string
          fx_rate: number
          id: string
          is_full_tank: boolean
          liters: number | null
          notes: string | null
          odometer: number
          payment_method: string
          qty_unit: string
          quantity: number
          receipt_path: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          settlement_id: string | null
          station_id: string | null
          status: string
          submitted_by: string | null
          trip_id: string | null
          truck_id: string
          unit_price_minor: number
          updated_at: string
        }
        Insert: {
          amount_base_minor?: number
          amount_minor: number
          created_at?: string
          created_by?: string | null
          currency?: string
          driver_id?: string | null
          filled_at: string
          fx_rate?: number
          id?: string
          is_full_tank?: boolean
          liters?: number | null
          notes?: string | null
          odometer: number
          payment_method?: string
          qty_unit?: string
          quantity: number
          receipt_path?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_id?: string | null
          station_id?: string | null
          status?: string
          submitted_by?: string | null
          trip_id?: string | null
          truck_id: string
          unit_price_minor: number
          updated_at?: string
        }
        Update: {
          amount_base_minor?: number
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          driver_id?: string | null
          filled_at?: string
          fx_rate?: number
          id?: string
          is_full_tank?: boolean
          liters?: number | null
          notes?: string | null
          odometer?: number
          payment_method?: string
          qty_unit?: string
          quantity?: number
          receipt_path?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_id?: string | null
          station_id?: string | null
          status?: string
          submitted_by?: string | null
          trip_id?: string | null
          truck_id?: string
          unit_price_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_fillups_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fuel_fillups_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "fuel_fillups_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_settlement_fk"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_profit_v"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["current_trip_id"]
          },
          {
            foreignKeyName: "fuel_fillups_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "fuel_fillups_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount_minor: number
          cargo_description: string | null
          cargo_weight_tons: number | null
          client_doc_no: string | null
          client_ref: string | null
          currency: string
          freight_minor: number
          fx_rate: number
          id: string
          invoice_id: string
          line_no: number
          load_date: string
          route: string | null
          trip_id: string | null
        }
        Insert: {
          amount_minor: number
          cargo_description?: string | null
          cargo_weight_tons?: number | null
          client_doc_no?: string | null
          client_ref?: string | null
          currency: string
          freight_minor: number
          fx_rate: number
          id?: string
          invoice_id: string
          line_no: number
          load_date: string
          route?: string | null
          trip_id?: string | null
        }
        Update: {
          amount_minor?: number
          cargo_description?: string | null
          cargo_weight_tons?: number | null
          client_doc_no?: string | null
          client_ref?: string | null
          currency?: string
          freight_minor?: number
          fx_rate?: number
          id?: string
          invoice_id?: string
          line_no?: number
          load_date?: string
          route?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_profit_v"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "invoice_lines_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["current_trip_id"]
          },
        ]
      }
      invoices: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          invoice_date: string
          invoice_no: number
          lines_count: number
          notes: string | null
          period_from: string
          period_to: string
          status: string
          subtotal_minor: number
          total_minor: number
          updated_at: string
          vat_minor: number
          vat_rate_pct: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          id?: string
          invoice_date: string
          invoice_no?: never
          lines_count: number
          notes?: string | null
          period_from: string
          period_to: string
          status?: string
          subtotal_minor: number
          total_minor: number
          updated_at?: string
          vat_minor: number
          vat_rate_pct: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          id?: string
          invoice_date?: string
          invoice_no?: never
          lines_count?: number
          notes?: string | null
          period_from?: string
          period_to?: string
          status?: string
          subtotal_minor?: number
          total_minor?: number
          updated_at?: string
          vat_minor?: number
          vat_rate_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_balance_v"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          entry_no: number
          id: string
          posted_at: string | null
          posted_by: string | null
          reversed_by_entry_id: string | null
          reverses_entry_id: string | null
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["journal_status"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          entry_date: string
          entry_no?: never
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          reversed_by_entry_id?: string | null
          reverses_entry_id?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["journal_status"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          entry_no?: never
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          reversed_by_entry_id?: string | null
          reverses_entry_id?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["journal_status"]
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_reversed_by_entry_id_fkey"
            columns: ["reversed_by_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          created_at: string
          credit_minor: number
          debit_minor: number
          description: string | null
          entry_id: string
          id: string
          line_no: number
          truck_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          credit_minor?: number
          debit_minor?: number
          description?: string | null
          entry_id: string
          id?: string
          line_no?: number
          truck_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          credit_minor?: number
          debit_minor?: number
          description?: string | null
          entry_id?: string
          id?: string
          line_no?: number
          truck_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "journal_lines_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          country: string
          created_at: string
          id: string
          is_active: boolean
          is_border_crossing: boolean
          name: string
          updated_at: string
        }
        Insert: {
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_border_crossing?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_border_crossing?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          driver_id: string | null
          email: string | null
          full_name: string
          role: Database["public"]["Enums"]["app_role"] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          email?: string | null
          full_name?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          email?: string | null
          full_name?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_driver_fk"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "profiles_driver_fk"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      service_schedules: {
        Row: {
          created_at: string
          id: string
          interval_days: number | null
          interval_km: number | null
          is_active: boolean
          last_done_odometer: number | null
          last_done_on: string | null
          service_name: string
          truck_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          interval_days?: number | null
          interval_km?: number | null
          is_active?: boolean
          last_done_odometer?: number | null
          last_done_on?: string | null
          service_name: string
          truck_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          interval_days?: number | null
          interval_km?: number | null
          is_active?: boolean
          last_done_odometer?: number | null
          last_done_on?: string | null
          service_name?: string
          truck_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_schedules_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "service_schedules_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          notes: string | null
          phone: string | null
          tax_number: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind: string
          name: string
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tire_installations: {
        Row: {
          created_at: string
          id: string
          installed_odometer: number
          installed_on: string
          km_run: number | null
          position_code: string
          removal_reason: string | null
          removed_odometer: number | null
          removed_on: string | null
          tire_id: string
          truck_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          installed_odometer: number
          installed_on: string
          km_run?: number | null
          position_code: string
          removal_reason?: string | null
          removed_odometer?: number | null
          removed_on?: string | null
          tire_id: string
          truck_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          installed_odometer?: number
          installed_on?: string
          km_run?: number | null
          position_code?: string
          removal_reason?: string | null
          removed_odometer?: number | null
          removed_on?: string | null
          tire_id?: string
          truck_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tire_installations_tire_id_fkey"
            columns: ["tire_id"]
            isOneToOne: false
            referencedRelation: "tires"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tire_installations_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "tire_installations_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      tires: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          notes: string | null
          purchase_date: string | null
          retread_count: number
          serial_no: string
          size: string | null
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          purchase_date?: string | null
          retread_count?: number
          serial_no: string
          size?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          purchase_date?: string | null
          retread_count?: number
          serial_no?: string
          size?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tires_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          cargo_description: string | null
          cargo_weight_tons: number | null
          client_doc_no: string | null
          client_id: string | null
          client_ref: string | null
          client_ref_no: number | null
          created_at: string
          created_by: string | null
          currency: string
          distance_km: number | null
          driver_id: string | null
          end_date: string | null
          end_odometer: number | null
          entry_source: string
          freight_base_minor: number
          freight_minor: number
          from_location_id: string | null
          fx_rate: number
          id: string
          invoice_id: string | null
          is_empty_return: boolean
          notes: string | null
          start_date: string
          start_odometer: number | null
          status: Database["public"]["Enums"]["trip_status"]
          to_location_id: string | null
          trip_no: number
          truck_id: string
          updated_at: string
        }
        Insert: {
          cargo_description?: string | null
          cargo_weight_tons?: number | null
          client_doc_no?: string | null
          client_id?: string | null
          client_ref?: string | null
          client_ref_no?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          distance_km?: number | null
          driver_id?: string | null
          end_date?: string | null
          end_odometer?: number | null
          entry_source?: string
          freight_base_minor?: number
          freight_minor?: number
          from_location_id?: string | null
          fx_rate?: number
          id?: string
          invoice_id?: string | null
          is_empty_return?: boolean
          notes?: string | null
          start_date: string
          start_odometer?: number | null
          status?: Database["public"]["Enums"]["trip_status"]
          to_location_id?: string | null
          trip_no?: never
          truck_id: string
          updated_at?: string
        }
        Update: {
          cargo_description?: string | null
          cargo_weight_tons?: number | null
          client_doc_no?: string | null
          client_id?: string | null
          client_ref?: string | null
          client_ref_no?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          distance_km?: number | null
          driver_id?: string | null
          end_date?: string | null
          end_odometer?: number | null
          entry_source?: string
          freight_base_minor?: number
          freight_minor?: number
          from_location_id?: string | null
          fx_rate?: number
          id?: string
          invoice_id?: string | null
          is_empty_return?: boolean
          notes?: string | null
          start_date?: string
          start_odometer?: number | null
          status?: Database["public"]["Enums"]["trip_status"]
          to_location_id?: string | null
          trip_no?: never
          truck_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_balance_v"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "trips_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "trips_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      truck_assets: {
        Row: {
          purchase_cost_base_minor: number
          purchase_date: string | null
          salvage_value_base_minor: number
          truck_id: string
          updated_at: string
          useful_life_months: number | null
        }
        Insert: {
          purchase_cost_base_minor?: number
          purchase_date?: string | null
          salvage_value_base_minor?: number
          truck_id: string
          updated_at?: string
          useful_life_months?: number | null
        }
        Update: {
          purchase_cost_base_minor?: number
          purchase_date?: string | null
          salvage_value_base_minor?: number
          truck_id?: string
          updated_at?: string
          useful_life_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "truck_assets_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: true
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "truck_assets_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: true
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      truck_documents: {
        Row: {
          created_at: string
          created_by: string | null
          doc_number: string | null
          doc_type: Database["public"]["Enums"]["document_type"]
          expiry_date: string | null
          file_path: string | null
          id: string
          issue_date: string | null
          issuer: string | null
          notes: string | null
          title: string | null
          truck_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_number?: string | null
          doc_type: Database["public"]["Enums"]["document_type"]
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          issue_date?: string | null
          issuer?: string | null
          notes?: string | null
          title?: string | null
          truck_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_number?: string | null
          doc_type?: Database["public"]["Enums"]["document_type"]
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          issue_date?: string | null
          issuer?: string | null
          notes?: string | null
          title?: string | null
          truck_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "truck_documents_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "truck_documents_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      truck_financing: {
        Row: {
          annual_rate_pct: number
          contract_no: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          lender: string
          notes: string | null
          principal_base_minor: number
          start_date: string
          term_months: number
          truck_id: string
          updated_at: string
        }
        Insert: {
          annual_rate_pct?: number
          contract_no?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          lender: string
          notes?: string | null
          principal_base_minor: number
          start_date: string
          term_months: number
          truck_id: string
          updated_at?: string
        }
        Update: {
          annual_rate_pct?: number
          contract_no?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          lender?: string
          notes?: string | null
          principal_base_minor?: number
          start_date?: string
          term_months?: number
          truck_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "truck_financing_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "truck_financing_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      trucks: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expected_km_per_liter: number | null
          fuel_tank_liters: number | null
          id: string
          is_active: boolean
          make: string | null
          model: string | null
          notes: string | null
          plate_number: string
          truck_type: string | null
          updated_at: string
          vin: string | null
          year: number | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expected_km_per_liter?: number | null
          fuel_tank_liters?: number | null
          id?: string
          is_active?: boolean
          make?: string | null
          model?: string | null
          notes?: string | null
          plate_number: string
          truck_type?: string | null
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expected_km_per_liter?: number | null
          fuel_tank_liters?: number | null
          id?: string
          is_active?: boolean
          make?: string | null
          model?: string | null
          notes?: string | null
          plate_number?: string
          truck_type?: string | null
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Relationships: []
      }
      work_order_lines: {
        Row: {
          created_at: string
          description: string
          id: string
          line_total_minor: number | null
          line_type: string
          part_number: string | null
          quantity: number
          unit_price_minor: number
          updated_at: string
          work_order_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          line_total_minor?: number | null
          line_type: string
          part_number?: string | null
          quantity?: number
          unit_price_minor: number
          updated_at?: string
          work_order_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          line_total_minor?: number | null
          line_type?: string
          part_number?: string | null
          quantity?: number
          unit_price_minor?: number
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_lines_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["open_work_order_id"]
          },
          {
            foreignKeyName: "work_order_lines_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          closed_on: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          fx_rate: number
          id: string
          invoice_no: string | null
          invoice_path: string | null
          kind: Database["public"]["Enums"]["work_order_kind"]
          odometer: number | null
          opened_on: string
          status: Database["public"]["Enums"]["work_order_status"]
          total_base_minor: number
          total_minor: number
          truck_id: string
          updated_at: string
          wo_no: number
          workshop_id: string | null
        }
        Insert: {
          closed_on?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          fx_rate?: number
          id?: string
          invoice_no?: string | null
          invoice_path?: string | null
          kind?: Database["public"]["Enums"]["work_order_kind"]
          odometer?: number | null
          opened_on: string
          status?: Database["public"]["Enums"]["work_order_status"]
          total_base_minor?: number
          total_minor?: number
          truck_id: string
          updated_at?: string
          wo_no?: never
          workshop_id?: string | null
        }
        Update: {
          closed_on?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          fx_rate?: number
          id?: string
          invoice_no?: string | null
          invoice_path?: string | null
          kind?: Database["public"]["Enums"]["work_order_kind"]
          odometer?: number | null
          opened_on?: string
          status?: Database["public"]["Enums"]["work_order_status"]
          total_base_minor?: number
          total_minor?: number
          truck_id?: string
          updated_at?: string
          wo_no?: never
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "work_orders_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "work_orders_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      audit_log_v: {
        Row: {
          action: string | null
          at: string | null
          id: number | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string | null
          user_email: string | null
          user_id: string | null
          user_name: string | null
        }
        Relationships: []
      }
      client_balance_v: {
        Row: {
          balance_minor: number | null
          cheques_pending_minor: number | null
          client_id: string | null
          invoiced_minor: number | null
          is_active: boolean | null
          last_invoice: string | null
          last_receipt: string | null
          name: string | null
          overdue_minor: number | null
          received_minor: number | null
          ref_code: string | null
          unbilled_loads: number | null
          unbilled_minor: number | null
        }
        Relationships: []
      }
      client_statement_v: {
        Row: {
          client_id: string | null
          created_at: string | null
          credit_minor: number | null
          debit_minor: number | null
          doc_id: string | null
          doc_no: number | null
          entry_date: string | null
          kind: string | null
          kind_order: number | null
          lines_count: number | null
          method: string | null
          period_from: string | null
          period_to: string | null
        }
        Relationships: []
      }
      document_expiry_v: {
        Row: {
          created_at: string | null
          created_by: string | null
          days_left: number | null
          doc_number: string | null
          doc_type: Database["public"]["Enums"]["document_type"] | null
          expiry_band: string | null
          expiry_date: string | null
          file_path: string | null
          id: string | null
          issue_date: string | null
          issuer: string | null
          notes: string | null
          plate_number: string | null
          title: string | null
          truck_code: string | null
          truck_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "truck_documents_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "truck_documents_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_advance_balance_v: {
        Row: {
          balance_base_minor: number | null
          driver_id: string | null
          full_name: string | null
          is_active: boolean | null
          last_settled_on: string | null
          open_advances_base_minor: number | null
          open_expenses_base_minor: number | null
          open_fuel_base_minor: number | null
          pending_base_minor: number | null
          pending_count: number | null
          pending_fuel_count: number | null
        }
        Relationships: []
      }
      fuel_alerts_v: {
        Row: {
          baseline_km_per_liter: number | null
          driver_id: string | null
          driver_name: string | null
          filled_on: string | null
          id: string | null
          km_per_liter: number | null
          km_since_last_full: number | null
          liters: number | null
          odometer: number | null
          trip_id: string | null
          truck_code: string | null
          truck_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fuel_fillups_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "fuel_fillups_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_profit_v"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["current_trip_id"]
          },
          {
            foreignKeyName: "fuel_fillups_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "fuel_fillups_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_efficiency_v: {
        Row: {
          amount_base_minor: number | null
          amount_minor: number | null
          baseline_km_per_liter: number | null
          currency: string | null
          driver_id: string | null
          filled_at: string | null
          filled_on: string | null
          id: string | null
          is_abnormal: boolean | null
          is_full_tank: boolean | null
          km_per_liter: number | null
          km_since_last_full: number | null
          liters: number | null
          odometer: number | null
          payment_method: string | null
          price_per_liter_base_minor: number | null
          qty_unit: string | null
          quantity: number | null
          receipt_path: string | null
          station_id: string | null
          trip_id: string | null
          truck_id: string | null
          unit_price_minor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fuel_fillups_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fuel_fillups_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "fuel_fillups_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_profit_v"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_fillups_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["current_trip_id"]
          },
          {
            foreignKeyName: "fuel_fillups_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "fuel_fillups_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines_v: {
        Row: {
          account_code: string | null
          account_id: string | null
          account_name: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          credit_minor: number | null
          debit_minor: number | null
          description: string | null
          entry_date: string | null
          entry_description: string | null
          entry_id: string | null
          entry_no: number | null
          id: string | null
          line_no: number | null
          source_type: string | null
          status: Database["public"]["Enums"]["journal_status"] | null
          truck_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "journal_lines_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      service_due_v: {
        Row: {
          current_odometer: number | null
          days_left: number | null
          due_status: string | null
          id: string | null
          interval_days: number | null
          interval_km: number | null
          km_left: number | null
          last_done_odometer: number | null
          last_done_on: string | null
          next_due_odometer: number | null
          next_due_on: string | null
          service_name: string | null
          truck_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_schedules_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "service_schedules_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_profit_v: {
        Row: {
          cargo_description: string | null
          client_id: string | null
          client_name: string | null
          currency: string | null
          distance_km: number | null
          driver_id: string | null
          driver_name: string | null
          end_date: string | null
          expenses_base_minor: number | null
          freight_base_minor: number | null
          freight_minor: number | null
          from_name: string | null
          fuel_base_minor: number | null
          fuel_liters: number | null
          is_empty_return: boolean | null
          km_per_liter: number | null
          profit_base_minor: number | null
          start_date: string | null
          status: Database["public"]["Enums"]["trip_status"] | null
          to_name: string | null
          trip_id: string | null
          trip_no: number | null
          truck_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_balance_v"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "trips_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_advance_balance_v"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "truck_overview_v"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "trips_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      truck_overview_v: {
        Row: {
          code: string | null
          current_driver_id: string | null
          current_driver_name: string | null
          current_trip_id: string | null
          expected_km_per_liter: number | null
          is_active: boolean | null
          make: string | null
          model: string | null
          odometer: number | null
          open_work_order_id: string | null
          plate_number: string | null
          status: string | null
          truck_id: string | null
          truck_type: string | null
          year: number | null
        }
        Relationships: []
      }
      truck_pnl_facts_v: {
        Row: {
          amount_base_minor: number | null
          category_name: string | null
          fact_date: string | null
          kind: string | null
          source_id: string | null
          source_table: string | null
          truck_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cancel_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
      create_invoice: {
        Args: {
          p_client_id: string
          p_invoice_date: string
          p_notes?: string
          p_trip_ids: string[]
        }
        Returns: string
      }
      driver_trip_action: {
        Args: { p_action: string; p_odometer: number; p_trip_id: string }
        Returns: string
      }
      generate_installments: {
        Args: { p_financing_id: string }
        Returns: number
      }
      post_journal_entry: { Args: { p_entry_id: string }; Returns: undefined }
      reverse_journal_entry: {
        Args: { p_date?: string; p_entry_id: string; p_reason?: string }
        Returns: string
      }
      settle_driver_advance: {
        Args: { p_driver_id: string; p_notes?: string; p_settled_on?: string }
        Returns: string
      }
      truck_pnl_monthly: {
        Args: { p_from: string; p_to: string; p_truck_id: string }
        Returns: {
          amount_base_minor: number
          category_name: string
          kind: string
          month: string
        }[]
      }
      truck_pnl_summary: {
        Args: { p_from: string; p_to: string; p_truck_id?: string }
        Returns: {
          amount_base_minor: number
          kind: string
          truck_id: string
        }[]
      }
    }
    Enums: {
      account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
      app_role: "manager" | "accountant" | "dispatcher" | "driver"
      document_type:
        | "registration"
        | "insurance"
        | "inspection"
        | "permit"
        | "other"
      journal_status: "draft" | "posted" | "reversed"
      trip_status: "planned" | "in_progress" | "completed" | "cancelled"
      work_order_kind: "service" | "repair" | "tires" | "inspection" | "other"
      work_order_status: "open" | "closed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["asset", "liability", "equity", "revenue", "expense"],
      app_role: ["manager", "accountant", "dispatcher", "driver"],
      document_type: [
        "registration",
        "insurance",
        "inspection",
        "permit",
        "other",
      ],
      journal_status: ["draft", "posted", "reversed"],
      trip_status: ["planned", "in_progress", "completed", "cancelled"],
      work_order_kind: ["service", "repair", "tires", "inspection", "other"],
      work_order_status: ["open", "closed", "cancelled"],
    },
  },
} as const
