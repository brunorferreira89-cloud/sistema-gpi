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
      alertas_semanais: {
        Row: {
          cliente_id: string
          conteudo: Json | null
          created_at: string | null
          enviado_em: string | null
          enviado_por: string | null
          id: string
          semana_fim: string
          semana_inicio: string
          status: string | null
        }
        Insert: {
          cliente_id: string
          conteudo?: Json | null
          created_at?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          id?: string
          semana_fim: string
          semana_inicio: string
          status?: string | null
        }
        Update: {
          cliente_id?: string
          conteudo?: Json | null
          created_at?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          id?: string
          semana_fim?: string
          semana_inicio?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alertas_semanais_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_semanais_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analises_ia: {
        Row: {
          acao: string | null
          analise: string | null
          cliente_id: string | null
          competencia: string
          gerado_em: string | null
          id: string
          indicador: string
          titulo: string | null
        }
        Insert: {
          acao?: string | null
          analise?: string | null
          cliente_id?: string | null
          competencia: string
          gerado_em?: string | null
          id?: string
          indicador: string
          titulo?: string | null
        }
        Update: {
          acao?: string | null
          analise?: string | null
          cliente_id?: string | null
          competencia?: string
          gerado_em?: string | null
          id?: string
          indicador?: string
          titulo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analises_ia_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_config: {
        Row: {
          cliente_id: string
          created_at: string | null
          id: string
          limite_amarelo: number
          limite_verde: number
          tipo: string
        }
        Insert: {
          cliente_id: string
          created_at?: string | null
          id?: string
          limite_amarelo: number
          limite_verde: number
          tipo: string
        }
        Update: {
          cliente_id?: string
          created_at?: string | null
          id?: string
          limite_amarelo?: number
          limite_verde?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_config_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          administrador_cpf: string | null
          administrador_nome: string | null
          cep: string | null
          cnpj: string | null
          created_at: string
          endereco_completo: string | null
          faturamento_faixa: string
          id: string
          nome_empresa: string
          observacoes: string | null
          razao_social: string | null
          responsavel_email: string | null
          responsavel_nome: string | null
          responsavel_whatsapp: string | null
          segmento: string
          status: string
        }
        Insert: {
          administrador_cpf?: string | null
          administrador_nome?: string | null
          cep?: string | null
          cnpj?: string | null
          created_at?: string
          endereco_completo?: string | null
          faturamento_faixa: string
          id?: string
          nome_empresa: string
          observacoes?: string | null
          razao_social?: string | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_whatsapp?: string | null
          segmento: string
          status?: string
        }
        Update: {
          administrador_cpf?: string | null
          administrador_nome?: string | null
          cep?: string | null
          cnpj?: string | null
          created_at?: string
          endereco_completo?: string | null
          faturamento_faixa?: string
          id?: string
          nome_empresa?: string
          observacoes?: string | null
          razao_social?: string | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_whatsapp?: string | null
          segmento?: string
          status?: string
        }
        Relationships: []
      }
      diagnostico_leads: {
        Row: {
          cnpj: string | null
          created_at: string | null
          dados_diagnostico: Json | null
          email: string
          faturamento: number | null
          id: string
          nome_empresa: string
          responsavel_nome: string | null
          score: number | null
          segmento: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          cnpj?: string | null
          created_at?: string | null
          dados_diagnostico?: Json | null
          email: string
          faturamento?: number | null
          id?: string
          nome_empresa: string
          responsavel_nome?: string | null
          score?: number | null
          segmento?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          cnpj?: string | null
          created_at?: string | null
          dados_diagnostico?: Json | null
          email?: string
          faturamento?: number | null
          id?: string
          nome_empresa?: string
          responsavel_nome?: string | null
          score?: number | null
          segmento?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      importacoes_nibo: {
        Row: {
          arquivo_nome: string | null
          cliente_id: string
          competencia: string
          created_at: string | null
          id: string
          importado_por: string | null
          observacao: string | null
          status: string | null
          total_contas_importadas: number | null
          total_contas_nao_mapeadas: number | null
        }
        Insert: {
          arquivo_nome?: string | null
          cliente_id: string
          competencia: string
          created_at?: string | null
          id?: string
          importado_por?: string | null
          observacao?: string | null
          status?: string | null
          total_contas_importadas?: number | null
          total_contas_nao_mapeadas?: number | null
        }
        Update: {
          arquivo_nome?: string | null
          cliente_id?: string
          competencia?: string
          created_at?: string | null
          id?: string
          importado_por?: string | null
          observacao?: string | null
          status?: string | null
          total_contas_importadas?: number | null
          total_contas_nao_mapeadas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "importacoes_nibo_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importacoes_nibo_importado_por_fkey"
            columns: ["importado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_indicadores: {
        Row: {
          ativo: boolean
          cliente_id: string | null
          conta_id: string | null
          conta_ids: string[] | null
          created_at: string | null
          descricao: string | null
          direcao: string
          id: string
          limite_ambar: number
          limite_verde: number
          nome: string
          ordem: number | null
          tipo_fonte: string
          totalizador_key: string | null
        }
        Insert: {
          ativo?: boolean
          cliente_id?: string | null
          conta_id?: string | null
          conta_ids?: string[] | null
          created_at?: string | null
          descricao?: string | null
          direcao?: string
          id?: string
          limite_ambar: number
          limite_verde: number
          nome: string
          ordem?: number | null
          tipo_fonte: string
          totalizador_key?: string | null
        }
        Update: {
          ativo?: boolean
          cliente_id?: string | null
          conta_id?: string | null
          conta_ids?: string[] | null
          created_at?: string | null
          descricao?: string | null
          direcao?: string
          id?: string
          limite_ambar?: number
          limite_verde?: number
          nome?: string
          ordem?: number | null
          tipo_fonte?: string
          totalizador_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_indicadores_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_indicadores_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "plano_de_contas"
            referencedColumns: ["id"]
          },
        ]
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
      reunioes: {
        Row: {
          ata: string | null
          cliente_id: string | null
          created_at: string | null
          data_reuniao: string
          formato: string | null
          horario: string | null
          id: string
          pauta: string | null
          realizada_por: string | null
          status: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          ata?: string | null
          cliente_id?: string | null
          created_at?: string | null
          data_reuniao: string
          formato?: string | null
          horario?: string | null
          id?: string
          pauta?: string | null
          realizada_por?: string | null
          status?: string | null
          tipo: string
          titulo: string
        }
        Update: {
          ata?: string | null
          cliente_id?: string | null
          created_at?: string | null
          data_reuniao?: string
          formato?: string | null
          horario?: string | null
          id?: string
          pauta?: string | null
          realizada_por?: string | null
          status?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "reunioes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reunioes_realizada_por_fkey"
            columns: ["realizada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reunioes_coletivas: {
        Row: {
          ata: string | null
          created_at: string | null
          dados_anonimizados: Json | null
          data_reuniao: string
          descricao_tema: string | null
          formato: string | null
          horario: string | null
          id: string
          participantes_confirmados: number | null
          realizada_por: string | null
          status: string | null
          tema_principal: string | null
          titulo: string
        }
        Insert: {
          ata?: string | null
          created_at?: string | null
          dados_anonimizados?: Json | null
          data_reuniao: string
          descricao_tema?: string | null
          formato?: string | null
          horario?: string | null
          id?: string
          participantes_confirmados?: number | null
          realizada_por?: string | null
          status?: string | null
          tema_principal?: string | null
          titulo: string
        }
        Update: {
          ata?: string | null
          created_at?: string | null
          dados_anonimizados?: Json | null
          data_reuniao?: string
          descricao_tema?: string | null
          formato?: string | null
          horario?: string | null
          id?: string
          participantes_confirmados?: number | null
          realizada_por?: string | null
          status?: string | null
          tema_principal?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "reunioes_coletivas_realizada_por_fkey"
            columns: ["realizada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saldos_contas: {
        Row: {
          cliente_id: string
          competencia: string
          created_at: string | null
          id: string
          nome_conta: string
          ordem: number | null
          saldo_final: number | null
          saldo_inicial: number | null
        }
        Insert: {
          cliente_id: string
          competencia: string
          created_at?: string | null
          id?: string
          nome_conta: string
          ordem?: number | null
          saldo_final?: number | null
          saldo_inicial?: number | null
        }
        Update: {
          cliente_id?: string
          competencia?: string
          created_at?: string | null
          id?: string
          nome_conta?: string
          ordem?: number | null
          saldo_final?: number | null
          saldo_inicial?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "saldos_contas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      socios: {
        Row: {
          cargo: string | null
          cliente_id: string
          cpf: string | null
          created_at: string | null
          email: string | null
          id: string
          nome: string
          ordem: number | null
          participacao_percentual: number | null
          whatsapp: string | null
        }
        Insert: {
          cargo?: string | null
          cliente_id: string
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nome: string
          ordem?: number | null
          participacao_percentual?: number | null
          whatsapp?: string | null
        }
        Update: {
          cargo?: string | null
          cliente_id?: string
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          participacao_percentual?: number | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "socios_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      sugestoes_metas_ia: {
        Row: {
          cliente_id: string
          competencia: string
          coordenada_comandante: string | null
          coordenada_gerada_em: string | null
          coordenada_tecnico: string | null
          gerado_em: string | null
          id: string
          narrativa: string | null
          sugestoes: Json
        }
        Insert: {
          cliente_id: string
          competencia: string
          coordenada_comandante?: string | null
          coordenada_gerada_em?: string | null
          coordenada_tecnico?: string | null
          gerado_em?: string | null
          id?: string
          narrativa?: string | null
          sugestoes: Json
        }
        Update: {
          cliente_id?: string
          competencia?: string
          coordenada_comandante?: string | null
          coordenada_gerada_em?: string | null
          coordenada_tecnico?: string | null
          gerado_em?: string | null
          id?: string
          narrativa?: string | null
          sugestoes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sugestoes_metas_ia_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas_operacionais: {
        Row: {
          cliente_id: string
          concluido_em: string | null
          created_at: string | null
          data_tarefa: string
          descricao: string | null
          id: string
          observacao: string | null
          prioridade: string
          responsavel_id: string | null
          status: string
          tipo: string
          titulo: string
        }
        Insert: {
          cliente_id: string
          concluido_em?: string | null
          created_at?: string | null
          data_tarefa: string
          descricao?: string | null
          id?: string
          observacao?: string | null
          prioridade?: string
          responsavel_id?: string | null
          status?: string
          tipo: string
          titulo: string
        }
        Update: {
          cliente_id?: string
          concluido_em?: string | null
          created_at?: string | null
          data_tarefa?: string
          descricao?: string | null
          id?: string
          observacao?: string | null
          prioridade?: string
          responsavel_id?: string | null
          status?: string
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_operacionais_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_operacionais_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      torre_metas: {
        Row: {
          cliente_id: string
          competencia: string
          conta_id: string
          created_at: string | null
          id: string
          meta_tipo: string
          meta_valor: number | null
          updated_at: string | null
        }
        Insert: {
          cliente_id: string
          competencia: string
          conta_id: string
          created_at?: string | null
          id?: string
          meta_tipo?: string
          meta_valor?: number | null
          updated_at?: string | null
        }
        Update: {
          cliente_id?: string
          competencia?: string
          conta_id?: string
          created_at?: string | null
          id?: string
          meta_tipo?: string
          meta_valor?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "torre_metas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "torre_metas_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "plano_de_contas"
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
