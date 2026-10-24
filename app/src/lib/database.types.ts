
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activities": {
                  Row: {
                    "approval_mode": string,"archived_at": string | null,"category_id": string,"chat_history": string,"created_at": string,"description": string | null,"duration_minutes": number,"embedding": string | null,"embedding_hash": string | null,"id": string,"max_size": number | null,"min_participants": number | null,"newcomer_friendly": boolean,"organised_by_association_id": string | null,"organised_by_collectif_id": string | null,"organiser_id": string,"place": unknown,"place_label": string,"published_at": string,"recurrence_interval_days": number | null,"recurrence_kind": string,"recurrence_weekdays": (number)[] | null,"removed_by_moderation_at": string | null,"search_tsv": unknown,"start_date": string,"start_time": string,"timezone": string,"title": string,"welcome_member_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_mode"?: string,"archived_at"?: string | null,"category_id": string,"chat_history"?: string,"created_at"?: string,"description"?: string | null,"duration_minutes"?: number,"embedding"?: string | null,"embedding_hash"?: string | null,"id"?: string,"max_size"?: number | null,"min_participants"?: number | null,"newcomer_friendly"?: boolean,"organised_by_association_id"?: string | null,"organised_by_collectif_id"?: string | null,"organiser_id": string,"place": unknown,"place_label": string,"published_at"?: string,"recurrence_interval_days"?: number | null,"recurrence_kind": string,"recurrence_weekdays"?: (number)[] | null,"removed_by_moderation_at"?: string | null,"search_tsv"?: never,"start_date": string,"start_time": string,"timezone"?: string,"title": string,"welcome_member_id"?: string | null
                  }
                  Update: {
                    "approval_mode"?: string,"archived_at"?: string | null,"category_id"?: string,"chat_history"?: string,"created_at"?: string,"description"?: string | null,"duration_minutes"?: number,"embedding"?: string | null,"embedding_hash"?: string | null,"id"?: string,"max_size"?: number | null,"min_participants"?: number | null,"newcomer_friendly"?: boolean,"organised_by_association_id"?: string | null,"organised_by_collectif_id"?: string | null,"organiser_id"?: string,"place"?: unknown,"place_label"?: string,"published_at"?: string,"recurrence_interval_days"?: number | null,"recurrence_kind"?: string,"recurrence_weekdays"?: (number)[] | null,"removed_by_moderation_at"?: string | null,"search_tsv"?: never,"start_date"?: string,"start_time"?: string,"timezone"?: string,"title"?: string,"welcome_member_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_organised_by_association_id_fkey"
      columns: ["organised_by_association_id"]
isOneToOne: false
      referencedRelation: "associations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_organised_by_collectif_id_fkey"
      columns: ["organised_by_collectif_id"]
isOneToOne: false
      referencedRelation: "collectifs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_organiser_id_fkey"
      columns: ["organiser_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_welcome_member_id_fkey"
      columns: ["welcome_member_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_interests": {
                  Row: {
                    "activity_id": string,"created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "activity_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_interests_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_interests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_members": {
                  Row: {
                    "activity_id": string,"joined_at": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"joined_at"?: string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "activity_id"?: string,"joined_at"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_members_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_tags": {
                  Row: {
                    "activity_id": string,"tag_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"tag_id": string
                  }
                  Update: {
                    "activity_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_tags_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"admin_audit_log": {
                  Row: {
                    "action": string,"admin_id": string | null,"created_at": string,"details": NonNullable<Json>,"id": string,"target_id": string | null,"target_type": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"admin_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Update: {
                    "action"?: string,"admin_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_audit_log_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"ambiance_words": {
                  Row: {
                    "id": string,"label_en": string,"label_fr": string,"slug": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"label_en": string,"label_fr": string,"slug": string,"sort_order"?: number
                  }
                  Update: {
                    "id"?: string,"label_en"?: string,"label_fr"?: string,"slug"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"association_claims": {
                  Row: {
                    "admin_note": string | null,"association_id": string,"claimant_id": string,"contact_email": string | null,"created_at": string,"decided_at": string | null,"document_path": string | null,"id": string,"proof_method": string,"role_in_association": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_note"?: string | null,"association_id": string,"claimant_id": string,"contact_email"?: string | null,"created_at"?: string,"decided_at"?: string | null,"document_path"?: string | null,"id"?: string,"proof_method": string,"role_in_association": string,"status"?: string
                  }
                  Update: {
                    "admin_note"?: string | null,"association_id"?: string,"claimant_id"?: string,"contact_email"?: string | null,"created_at"?: string,"decided_at"?: string | null,"document_path"?: string | null,"id"?: string,"proof_method"?: string,"role_in_association"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "association_claims_association_id_fkey"
      columns: ["association_id"]
isOneToOne: false
      referencedRelation: "associations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "association_claims_claimant_id_fkey"
      columns: ["claimant_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"association_tags": {
                  Row: {
                    "association_id": string,"tag_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "association_id": string,"tag_id": string
                  }
                  Update: {
                    "association_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "association_tags_association_id_fkey"
      columns: ["association_id"]
isOneToOne: false
      referencedRelation: "associations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "association_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"association_waiters": {
                  Row: {
                    "association_id": string,"created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "association_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "association_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "association_waiters_association_id_fkey"
      columns: ["association_id"]
isOneToOne: false
      referencedRelation: "associations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "association_waiters_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"associations": {
                  Row: {
                    "address": string | null,"attribution": NonNullable<Json>,"city": string | null,"claimed_by": string | null,"confidence": number,"created_at": string,"created_by": string | null,"email": string | null,"embedding": string | null,"embedding_hash": string | null,"geocode_precision": string | null,"id": string,"insee_code": string | null,"last_import_run": string | null,"likely_not_public": boolean,"location": unknown,"locked_fields": (string)[],"name": string,"name_norm": string | null,"opening_hours": string | null,"osm_id": string | null,"phone": string | null,"postcode": string | null,"purpose": string | null,"removed_at": string | null,"reviewed_at": string | null,"rna_id": string | null,"rna_published_on": string | null,"search_tsv": unknown,"source": string,"town_point": unknown,"updated_at": string,"verified": boolean,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"attribution"?: NonNullable<Json>,"city"?: string | null,"claimed_by"?: string | null,"confidence"?: number,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"embedding"?: string | null,"embedding_hash"?: string | null,"geocode_precision"?: string | null,"id"?: string,"insee_code"?: string | null,"last_import_run"?: string | null,"likely_not_public"?: boolean,"location"?: unknown,"locked_fields"?: (string)[],"name": string,"name_norm"?: never,"opening_hours"?: string | null,"osm_id"?: string | null,"phone"?: string | null,"postcode"?: string | null,"purpose"?: string | null,"removed_at"?: string | null,"reviewed_at"?: string | null,"rna_id"?: string | null,"rna_published_on"?: string | null,"search_tsv"?: never,"source": string,"town_point"?: never,"updated_at"?: string,"verified"?: boolean,"website"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"attribution"?: NonNullable<Json>,"city"?: string | null,"claimed_by"?: string | null,"confidence"?: number,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"embedding"?: string | null,"embedding_hash"?: string | null,"geocode_precision"?: string | null,"id"?: string,"insee_code"?: string | null,"last_import_run"?: string | null,"likely_not_public"?: boolean,"location"?: unknown,"locked_fields"?: (string)[],"name"?: string,"name_norm"?: never,"opening_hours"?: string | null,"osm_id"?: string | null,"phone"?: string | null,"postcode"?: string | null,"purpose"?: string | null,"removed_at"?: string | null,"reviewed_at"?: string | null,"rna_id"?: string | null,"rna_published_on"?: string | null,"search_tsv"?: never,"source"?: string,"town_point"?: never,"updated_at"?: string,"verified"?: boolean,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "associations_claimed_by_fkey"
      columns: ["claimed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "associations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"attendances": {
                  Row: {
                    "guest_count": number,"session_id": string,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "guest_count"?: number,"session_id": string,"status": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "guest_count"?: number,"session_id"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendances_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendances_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"banned_words": {
                  Row: {
                    "added_by": string | null,"created_at": string,"word": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"created_at"?: string,"word": string
                  }
                  Update: {
                    "added_by"?: string | null,"created_at"?: string,"word"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "banned_words_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"blocks": {
                  Row: {
                    "blocked_id": string,"blocker_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_id": string,"blocker_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_id"?: string,"blocker_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "blocks_blocked_id_fkey"
      columns: ["blocked_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blocks_blocker_id_fkey"
      columns: ["blocker_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "icon": string,"id": string,"name_en": string,"name_fr": string,"parent_id": string | null,"slug": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "icon": string,"id"?: string,"name_en": string,"name_fr": string,"parent_id"?: string | null,"slug": string,"sort_order"?: number
                  }
                  Update: {
                    "icon"?: string,"id"?: string,"name_en"?: string,"name_fr"?: string,"parent_id"?: string | null,"slug"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"category_requests": {
                  Row: {
                    "admin_note": string | null,"created_at": string,"decided_at": string | null,"id": string,"requested_name": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_note"?: string | null,"created_at"?: string,"decided_at"?: string | null,"id"?: string,"requested_name": string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "admin_note"?: string | null,"created_at"?: string,"decided_at"?: string | null,"id"?: string,"requested_name"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "category_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_send_log": {
                  Row: {
                    "sent_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "sent_at"?: string,"user_id": string
                  }
                  Update: {
                    "sent_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_send_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_states": {
                  Row: {
                    "activity_id": string,"last_read_at": string,"muted": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"last_read_at"?: string,"muted"?: boolean,"user_id": string
                  }
                  Update: {
                    "activity_id"?: string,"last_read_at"?: string,"muted"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_states_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_states_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"collectif_invite_log": {
                  Row: {
                    "invited_at": string,"invited_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "invited_at"?: string,"invited_by": string
                  }
                  Update: {
                    "invited_at"?: string,"invited_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "collectif_invite_log_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"collectif_members": {
                  Row: {
                    "accepted_at": string | null,"collectif_id": string,"invited_at": string,"invited_by": string | null,"role": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"collectif_id": string,"invited_at"?: string,"invited_by"?: string | null,"role": string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"collectif_id"?: string,"invited_at"?: string,"invited_by"?: string | null,"role"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "collectif_members_collectif_id_fkey"
      columns: ["collectif_id"]
isOneToOne: false
      referencedRelation: "collectifs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "collectif_members_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "collectif_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"collectifs": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"embedding": string | null,"embedding_hash": string | null,"id": string,"name": string,"search_tsv": unknown,"town_label": string,"town_point": unknown
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"embedding"?: string | null,"embedding_hash"?: string | null,"id"?: string,"name": string,"search_tsv"?: never,"town_label": string,"town_point": unknown
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"embedding"?: string | null,"embedding_hash"?: string | null,"id"?: string,"name"?: string,"search_tsv"?: never,"town_label"?: string,"town_point"?: unknown
                  }
                  Relationships: [
                    {
      foreignKeyName: "collectifs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"feedback": {
                  Row: {
                    "app_version": string | null,"body": string,"created_at": string,"device_model": string | null,"id": string,"screenshot_path": string | null,"source": string,"status": string,"type": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_version"?: string | null,"body": string,"created_at"?: string,"device_model"?: string | null,"id"?: string,"screenshot_path"?: string | null,"source"?: string,"status"?: string,"type": string,"user_id"?: string | null
                  }
                  Update: {
                    "app_version"?: string | null,"body"?: string,"created_at"?: string,"device_model"?: string | null,"id"?: string,"screenshot_path"?: string | null,"source"?: string,"status"?: string,"type"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "feedback_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"import_runs": {
                  Row: {
                    "counts": NonNullable<Json>,"error": string | null,"finished_at": string | null,"id": string,"scope": (string)[] | null,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "counts"?: NonNullable<Json>,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"scope"?: (string)[] | null,"started_at"?: string,"status"?: string
                  }
                  Update: {
                    "counts"?: NonNullable<Json>,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"scope"?: (string)[] | null,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"limit_log": {
                  Row: {
                    "at": string,"id": number,"kind": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"id"?: number,"kind": string,"user_id": string
                  }
                  Update: {
                    "at"?: string,"id"?: number,"kind"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "limit_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "activity_id": string | null,"body": string,"created_at": string,"id": string,"recipient_id": string | null,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id"?: string | null,"body": string,"created_at"?: string,"id"?: string,"recipient_id"?: string | null,"sender_id": string
                  }
                  Update: {
                    "activity_id"?: string | null,"body"?: string,"created_at"?: string,"id"?: string,"recipient_id"?: string | null,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_log": {
                  Row: {
                    "id": number,"kind": string,"sent_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: number,"kind": string,"sent_at"?: string,"user_id": string
                  }
                  Update: {
                    "id"?: number,"kind"?: string,"sent_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_outbox": {
                  Row: {
                    "attempts": number,"body": string,"data": NonNullable<Json>,"dedupe_key": string | null,"failed_at": string | null,"id": number,"kind": string,"last_error": string | null,"send_after": string,"sent_at": string | null,"title": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"body": string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"failed_at"?: string | null,"id"?: number,"kind": string,"last_error"?: string | null,"send_after"?: string,"sent_at"?: string | null,"title": string,"user_id": string
                  }
                  Update: {
                    "attempts"?: number,"body"?: string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"failed_at"?: string | null,"id"?: number,"kind"?: string,"last_error"?: string | null,"send_after"?: string,"sent_at"?: string | null,"title"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_outbox_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organiser_stats": {
                  Row: {
                    "badge_status": string,"distinct_participants": number,"feedback_count": number,"late_cancel_rate": number,"positive_count": number,"revoked_until": string | null,"sessions_held": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "badge_status"?: string,"distinct_participants"?: number,"feedback_count"?: number,"late_cancel_rate"?: number,"positive_count"?: number,"revoked_until"?: string | null,"sessions_held"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "badge_status"?: string,"distinct_participants"?: number,"feedback_count"?: number,"late_cancel_rate"?: number,"positive_count"?: number,"revoked_until"?: string | null,"sessions_held"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organiser_stats_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "age_confirmed": boolean,"banned_at": string | null,"bio": string | null,"created_at": string,"first_name": string,"home_area": unknown,"home_area_label": string | null,"id": string,"inactivity_notice_at": string | null,"language": string,"last_seen_at": string | null,"phone_verified": boolean,"photo_url": string | null,"role": string,"supporter": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "age_confirmed"?: boolean,"banned_at"?: string | null,"bio"?: string | null,"created_at"?: string,"first_name"?: string,"home_area"?: unknown,"home_area_label"?: string | null,"id": string,"inactivity_notice_at"?: string | null,"language"?: string,"last_seen_at"?: string | null,"phone_verified"?: boolean,"photo_url"?: string | null,"role"?: string,"supporter"?: boolean
                  }
                  Update: {
                    "age_confirmed"?: boolean,"banned_at"?: string | null,"bio"?: string | null,"created_at"?: string,"first_name"?: string,"home_area"?: unknown,"home_area_label"?: string | null,"id"?: string,"inactivity_notice_at"?: string | null,"language"?: string,"last_seen_at"?: string | null,"phone_verified"?: boolean,"photo_url"?: string | null,"role"?: string,"supporter"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"push_tokens": {
                  Row: {
                    "platform": string,"token": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "platform": string,"token": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "platform"?: string,"token"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_tokens_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"report_snapshots": {
                  Row: {
                    "report_id": string,"snapshot": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "report_id": string,"snapshot": NonNullable<Json>
                  }
                  Update: {
                    "report_id"?: string,"snapshot"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_snapshots_report_id_fkey"
      columns: ["report_id"]
isOneToOne: true
      referencedRelation: "reports"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"decision": string | null,"details": string | null,"id": string,"reason": string,"reporter_id": string | null,"source": string,"statement_of_reasons": string | null,"status": string,"target_id": string,"target_owner": string | null,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string | null,"details"?: string | null,"id"?: string,"reason": string,"reporter_id"?: string | null,"source"?: string,"statement_of_reasons"?: string | null,"status"?: string,"target_id": string,"target_owner"?: string | null,"target_type": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string | null,"details"?: string | null,"id"?: string,"reason"?: string,"reporter_id"?: string | null,"source"?: string,"statement_of_reasons"?: string | null,"status"?: string,"target_id"?: string,"target_owner"?: string | null,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_target_owner_fkey"
      columns: ["target_owner"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"safety_tips_seen": {
                  Row: {
                    "tip_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "tip_id": string,"user_id": string
                  }
                  Update: {
                    "tip_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "safety_tips_seen_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_searches": {
                  Row: {
                    "alert": boolean,"center": unknown,"created_at": string,"filters": NonNullable<Json>,"id": string,"query": string,"radius_km": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert"?: boolean,"center": unknown,"created_at"?: string,"filters"?: NonNullable<Json>,"id"?: string,"query": string,"radius_km": number,"user_id": string
                  }
                  Update: {
                    "alert"?: boolean,"center"?: unknown,"created_at"?: string,"filters"?: NonNullable<Json>,"id"?: string,"query"?: string,"radius_km"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_searches_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"search_misses": {
                  Row: {
                    "area_label": string | null,"created_at": string,"day": string,"hits": number,"id": number,"query": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_label"?: string | null,"created_at"?: string,"day"?: string,"hits"?: number,"id"?: number,"query": string
                  }
                  Update: {
                    "area_label"?: string | null,"created_at"?: string,"day"?: string,"hits"?: number,"id"?: number,"query"?: string
                  }
                  Relationships: [
                    
                  ]
                },"session_feedback": {
                  Row: {
                    "ambiance_word_ids": (string)[],"created_at": string,"session_id": string,"user_id": string,"went_well": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "ambiance_word_ids"?: (string)[],"created_at"?: string,"session_id": string,"user_id": string,"went_well": boolean
                  }
                  Update: {
                    "ambiance_word_ids"?: (string)[],"created_at"?: string,"session_id"?: string,"user_id"?: string,"went_well"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_feedback_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "session_feedback_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"session_horizons": {
                  Row: {
                    "activity_id": string,"until": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"until": string
                  }
                  Update: {
                    "activity_id"?: string,"until"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_horizons_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: true
      referencedRelation: "activities"
      referencedColumns: ["id"]
    }
                  ]
                },"sessions": {
                  Row: {
                    "activity_id": string,"cancelled_at": string | null,"id": string,"is_discovery": boolean,"place": unknown,"place_label": string | null,"starts_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"cancelled_at"?: string | null,"id"?: string,"is_discovery"?: boolean,"place"?: unknown,"place_label"?: string | null,"starts_at": string,"status"?: string
                  }
                  Update: {
                    "activity_id"?: string,"cancelled_at"?: string | null,"id"?: string,"is_discovery"?: boolean,"place"?: unknown,"place_label"?: string | null,"starts_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sessions_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    }
                  ]
                },"storage_deletions": {
                  Row: {
                    "bucket": string,"id": number,"path": string,"queued_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"id"?: number,"path": string,"queued_at"?: string
                  }
                  Update: {
                    "bucket"?: string,"id"?: number,"path"?: string,"queued_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tags": {
                  Row: {
                    "id": string,"label_en": string,"label_fr": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"label_en": string,"label_fr": string,"slug": string
                  }
                  Update: {
                    "id"?: string,"label_en"?: string,"label_fr"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_interests": {
                  Row: {
                    "category_id": string,"level": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"level": string,"user_id": string
                  }
                  Update: {
                    "category_id"?: string,"level"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_interests_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_interests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "organiser_badges": {
                  Row: {
                    "badge_status": string | null,"distinct_participants": number | null,"sessions_held": number | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "badge_status"?: string | null,"distinct_participants"?: number | null,"sessions_held"?: number | null,"user_id"?: string | null
                         }
                        Update: {
                           "badge_status"?: string | null,"distinct_participants"?: number | null,"sessions_held"?: number | null,"user_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "organiser_stats_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "activity_date_matches":
{ Args: { "p_d": string,"p_interval_days": number,"p_kind": string,"p_start": string,"p_weekdays": (number)[] }; Returns: boolean
                           },
"activity_roster":
{ Args: { "p_activity": string }; Returns: {
              "first_name": string,"photo_url": string,"status": string,"user_id": string
            }[]
                           },
"admin_audit_page":
{ Args: { "p_before_at"?: string,"p_before_id"?: string,"p_limit"?: number }; Returns: Json
                           },
"admin_banned_users":
{ Args: { "p_limit"?: number,"p_query"?: string }; Returns: Json
                           },
"admin_category_requests":
{ Args: { "p_before_at"?: string,"p_before_id"?: string,"p_limit"?: number }; Returns: Json
                           },
"admin_claim_document_path":
{ Args: { "p_claim": string }; Returns: string
                           },
"admin_claims":
{ Args: { "p_before_at"?: string,"p_before_id"?: string,"p_limit"?: number,"p_status"?: string }; Returns: Json
                           },
"admin_community_clubs":
{ Args: { "p_before_at"?: string,"p_before_id"?: string,"p_limit"?: number }; Returns: Json
                           },
"admin_decide_category":
{ Args: { "p_action": string,"p_id": string,"p_into"?: string,"p_name_en"?: string,"p_note"?: string,"p_parent"?: string }; Returns: undefined
                           },
"admin_decide_claim":
{ Args: { "p_approve": boolean,"p_claim": string,"p_note"?: string }; Returns: undefined
                           },
"admin_decide_club":
{ Args: { "p_action": string,"p_id": string,"p_into"?: string,"p_note"?: string }; Returns: undefined
                           },
"admin_decide_report":
{ Args: { "p_decision": string,"p_report": string,"p_statement": string }; Returns: undefined
                           },
"admin_feedback":
{ Args: { "p_before_at"?: string,"p_before_id"?: string,"p_limit"?: number,"p_status"?: string }; Returns: Json
                           },
"admin_feedback_screenshot_path":
{ Args: { "p_id": string }; Returns: string
                           },
"admin_lift_ban":
{ Args: { "p_statement": string,"p_user": string }; Returns: undefined
                           },
"admin_log":
{ Args: { "p_action": string,"p_details"?: Json,"p_target_id": string,"p_target_type": string }; Returns: undefined
                           },
"admin_reports":
{ Args: { "p_before_at"?: string,"p_before_id"?: string,"p_limit"?: number,"p_status"?: string }; Returns: Json
                           },
"admin_search_associations":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: Json
                           },
"admin_set_banned_word":
{ Args: { "p_add": boolean,"p_word": string }; Returns: undefined
                           },
"admin_set_feedback_status":
{ Args: { "p_id": string,"p_status": string }; Returns: undefined
                           },
"association_locked_for_me":
{ Args: { "p_id": string }; Returns: boolean
                           },
"ban_user":
{ Args: { "p_reason": string,"p_user": string }; Returns: undefined
                           },
"can_organise":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"chat_joined_at":
{ Args: { "p_activity": string,"p_user": string }; Returns: string
                           },
"chat_messages":
{ Args: { "p_activity": string,"p_after_at"?: string,"p_after_id"?: string,"p_before_at"?: string,"p_before_id"?: string,"p_limit"?: number }; Returns: Json
                           },
"chat_visible_since":
{ Args: { "p_activity": string }; Returns: string
                           },
"claim_outbox":
{ Args: { "p_limit"?: number }; Returns: Json
                           },
"collectif_blocked_for_me":
{ Args: { "p_collectif": string }; Returns: boolean
                           },
"collectif_candidates":
{ Args: { "p_collectif": string }; Returns: {
              "first_name": string,"photo_url": string,"user_id": string
            }[]
                           },
"collectif_invite_register":
{ Args: { "p_collectif": string,"p_user": string }; Returns: undefined
                           },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"delete_my_messages_in_left_activities":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"drain_outbox":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"drain_storage_deletions":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"enqueue_reminders":
{ Args: { "p_now"?: string }; Returns: number
                           },
"export_my_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"extend_sessions":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"generate_sessions":
{ Args: { "p_activity": string,"p_from"?: string,"p_until": string }; Returns: number
                           },
"get_activity":
{ Args: { "p_id": string }; Returns: Json
                           },
"get_association":
{ Args: { "p_id": string }; Returns: Json
                           },
"get_collectif":
{ Args: { "p_id": string }; Returns: Json
                           },
"has_confirmed_attendance":
{ Args: { "p_session": string }; Returns: boolean
                           },
"is_activity_member":
{ Args: { "p_activity": string }; Returns: boolean
                           },
"is_activity_organiser":
{ Args: { "p_activity": string }; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_banned":
{ Args: { "p_user": string }; Returns: boolean
                           },
"is_blocked_between":
{ Args: { "p_other": string }; Returns: boolean
                           },
"is_collectif_member":
{ Args: { "p_collectif": string }; Returns: boolean
                           },
"is_collectif_responsable":
{ Args: { "p_collectif": string }; Returns: boolean
                           },
"is_session_member":
{ Args: { "p_session": string }; Returns: boolean
                           },
"is_session_organiser":
{ Args: { "p_session": string }; Returns: boolean
                           },
"link_collectif_to_association":
{ Args: { "p_association": string,"p_collectif": string }; Returns: number
                           },
"mark_chat_read":
{ Args: { "p_activity": string }; Returns: undefined
                           },
"my_activities":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_blocked":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_chats":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_moderation_notices":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_recent_community_clubs":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"my_unread_total":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"notif_text":
{ Args: { "p_kind": string,"p_lang": string }; Returns: {
              "body": string,"title": string
            }[]
                           },
"notif_when":
{ Args: { "p_lang": string,"p_time_only"?: boolean,"p_ts": string,"p_tz": string }; Returns: string
                           },
"notify_user":
{ Args: { "p_actor"?: string,"p_body_en": string,"p_body_fr": string,"p_data"?: Json,"p_dedupe"?: string,"p_kind": string,"p_send_after"?: string,"p_title_en": string,"p_title_fr": string,"p_user": string }; Returns: undefined
                           },
"prune_chat_send_log":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"prune_limit_log":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"prune_messages":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"prune_outbox":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"purge_account":
{ Args: { "p_user": string }; Returns: undefined
                           },
"queue_user_storage_deletion":
{ Args: { "p_user": string }; Returns: undefined
                           },
"register_push_token":
{ Args: { "p_platform": string,"p_token": string }; Returns: undefined
                           },
"reminder_still_valid":
{ Args: { "p_session": string,"p_user": string }; Returns: boolean
                           },
"report_target_owner":
{ Args: { "p_id": string,"p_type": string }; Returns: string
                           },
"run_inactive_accounts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"run_retention":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"search_explore":
{ Args: { "p_discovery_only"?: boolean,"p_interest_category_ids"?: (string)[],"p_kinds"?: (string)[],"p_lat": number,"p_limit"?: number,"p_lon": number,"p_newcomer_friendly"?: boolean,"p_offset"?: number,"p_query"?: string,"p_query_embedding"?: string,"p_radius_km"?: number,"p_sort"?: string,"p_weekday"?: number }; Returns: Json
                           },
"search_linkable_associations":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: {
              "city": string,"id": string,"name": string,"postcode": string
            }[]
                           },
"session_card":
{ Args: { "p_session": string,"p_with_attendees": boolean }; Returns: Json
                           },
"session_has_member":
{ Args: { "p_session": string,"p_user": string }; Returns: boolean
                           },
"session_matches_rule":
{ Args: { "a": Omit<Database["public"]['Tables']["activities"]['Row'], Database["public"]['Tables']["activities"]['ComputedFields']>,"p_starts_at": string }; Returns: boolean
                           },
"set_chat_muted":
{ Args: { "p_activity": string,"p_muted": boolean }; Returns: undefined
                           },
"take_limit":
{ Args: { "p_kind": string,"p_max": number,"p_window": string }; Returns: undefined
                           },
"text_has_banned_word":
{ Args: { "p_text": string }; Returns: boolean
                           },
"touch_last_seen":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
