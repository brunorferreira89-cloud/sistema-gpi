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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      clientes: {
        Row: {
          created_at: string
          faturamento_faixa: string
          id: string
          nome_empresa: string
          observacoes: string | null
          responsavel_email: string | null
          responsavel_nome: string | null
          responsavel_whatsapp: string | null
          segmento: string
          status: string
        }
        Insert: {
          created_at?: string
          faturamento_faixa: string
          id?: string
          nome_empresa: string
          observacoes?: string | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_whatsapp?: string | null
          segmento: string
          status?: string
        }
        Update: {
          created_at?: string
          faturamento_faixa?: string
          id?: string
          nome_empresa?: string
          observacoes?: string | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_whatsapp?: string | null
          segmento?: string
          status?: string
        }
        Relationships: []
      }
      onboarding_checklist: {
        Row: {
          cliente_id: string
          concluido: boolean | null
          concluido_em: string | null
          concluido_por: string | null
          created_at: string | null
          id: string
          item: string
          ordem: number
          semana: number
        }
        Insert: {
          cliente_id: string
          concluido?: boolean | null
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string | null
          id?: string
          item: string
          ordem?: number
          semana: number
        }
        Update: {
          cliente_id?: string
          concluido?: boolean | null
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string | null
          id?: string
          item?: string
          ordem?: number
          semana?: number
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_checklist_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_checklist_concluido_por_fkey"
            columns: ["concluido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_de_contas: {
        Row: {
          cliente_id: string
          conta_pai_id: string | null
          created_at: string | null
          id: string
          is_total: boolean | null
          nivel: number
          nome: string
          ordem: number
          tipo: string
        }
        Insert: {
          cliente_id: string
          conta_pai_id?: string | null
          created_at?: string | null
          id?: string
          is_total?: boolean | null
          nivel?: number
          nome: string
          ordem?: number
          tipo: string
        }
        Update: {
          cliente_id?: string
          conta_pai_id?: string | null
          created_at?: string | null
          id?: string
          is_total?: boolean | null
          nivel?: number
          nome?: string
          ordem?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_de_contas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_de_contas_conta_pai_id_fkey"
            columns: ["conta_pai_id"]
            isOneToOne: false
            referencedRelation: "plano_de_contas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          cliente_id: string | null
          created_at: string
          id: string
          nome: string | null
          role: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          id: string
          nome?: string | null
          role?: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          nome?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      treinamento_progresso: {
        Row: {
          cliente_id: string
          concluido: boolean | null
          concluido_em: string | null
          created_at: string | null
          id: string
          modulo: string
          observacao: string | null
          ordem: number
          titulo: string
        }
        Insert: {
          cliente_id: string
          concluido?: boolean | null
          concluido_em?: string | null
          created_at?: string | null
          id?: string
          modulo: string
          observacao?: string | null
          ordem?: number
          titulo: string
        }
        Update: {
          cliente_id?: string
          concluido?: boolean | null
          concluido_em?: string | null
          created_at?: string | null
          id?: string
          modulo?: string
          observacao?: string | null
          ordem?: number
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "treinamento_progresso_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      valores_mensais: {
        Row: {
          competencia: string
          conta_id: string
          created_at: string | null
          id: string
          valor_meta: number | null
          valor_realizado: number | null
        }
        Insert: {
          competencia: string
          conta_id: string
          created_at?: string | null
          id?: string
          valor_meta?: number | null
          valor_realizado?: number | null
        }
        Update: {
          competencia?: string
          conta_id?: string
          created_at?: string | null
          id?: string
          valor_meta?: number | null
          valor_realizado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "valores_mensais_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "plano_de_contas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_cliente_id: { Args: { _user_id: string }; Returns: string }
      get_user_role: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
