import {
  LINZ_GYMS,
  LINZ_PROFILES,
  LINZ_GYM_STAFF,
  LINZ_COACHES,
  LINZ_AFFILIATIONS,
  LINZ_AVAILABILITY,
  LINZ_BOOKINGS,
  LINZ_PASSES,
} from '@/lib/data/linz-seed';
import {
  InMemoryDatastore,
  MockAuthContext,
  MockAuthUser,
  RlsPolicyEvaluator,
} from './rls-evaluator';

export type PostgrestFilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'is';

export interface FilterCondition {
  column: string;
  operator: PostgrestFilterOperator;
  value: any;
}

export interface PostgrestResponse<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

/**
 * Global in-memory storage holding table rows
 */
function createDefaultStore(): InMemoryDatastore {
  return {
    gyms: JSON.parse(JSON.stringify(LINZ_GYMS)),
    profiles: JSON.parse(JSON.stringify(LINZ_PROFILES)),
    gym_staff: JSON.parse(JSON.stringify(LINZ_GYM_STAFF)),
    coach_profiles: JSON.parse(JSON.stringify(LINZ_COACHES)),
    coach_gym_affiliations: JSON.parse(JSON.stringify(LINZ_AFFILIATIONS)),
    coach_availability: JSON.parse(JSON.stringify(LINZ_AVAILABILITY)),
    bookings: JSON.parse(JSON.stringify(LINZ_BOOKINGS)),
    check_in_passes: JSON.parse(JSON.stringify(LINZ_PASSES)),
  };
}

let activeDatastore: InMemoryDatastore = createDefaultStore();

export function getMockDatastore(): InMemoryDatastore {
  return activeDatastore;
}

export function resetMockDatastore(): void {
  activeDatastore = createDefaultStore();
}

/**
 * PostgrestQueryBuilder mock providing chainable API matching Supabase JS client
 */
export class MockPostgrestQueryBuilder<T = any> implements PromiseLike<PostgrestResponse<T[]>> {
  private tableName: keyof InMemoryDatastore;
  private context: MockAuthContext;
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private selectedColumns: string = '*';
  private insertData: any = null;
  private updateData: any = null;
  private filters: FilterCondition[] = [];
  private orderColumn?: string;
  private orderAscending: boolean = true;
  private limitCount?: number;
  private isSingle: boolean = false;
  private isMaybeSingle: boolean = false;

  constructor(tableName: keyof InMemoryDatastore, context: MockAuthContext) {
    this.tableName = tableName;
    this.context = context;
  }

  public select(columns: string = '*'): this {
    this.action = 'select';
    this.selectedColumns = columns;
    return this;
  }

  public insert(values: any | any[]): this {
    this.action = 'insert';
    this.insertData = Array.isArray(values) ? values : [values];
    return this;
  }

  public update(values: any): this {
    this.action = 'update';
    this.updateData = values;
    return this;
  }

  public delete(): this {
    this.action = 'delete';
    return this;
  }

  public eq(column: string, value: any): this {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }

  public neq(column: string, value: any): this {
    this.filters.push({ column, operator: 'neq', value });
    return this;
  }

  public gt(column: string, value: any): this {
    this.filters.push({ column, operator: 'gt', value });
    return this;
  }

  public gte(column: string, value: any): this {
    this.filters.push({ column, operator: 'gte', value });
    return this;
  }

  public lt(column: string, value: any): this {
    this.filters.push({ column, operator: 'lt', value });
    return this;
  }

  public lte(column: string, value: any): this {
    this.filters.push({ column, operator: 'lte', value });
    return this;
  }

  public in(column: string, values: any[]): this {
    this.filters.push({ column, operator: 'in', value: values });
    return this;
  }

  public is(column: string, value: any): this {
    this.filters.push({ column, operator: 'is', value });
    return this;
  }

  public order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  public limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  public single(): Promise<PostgrestResponse<T>> {
    this.isSingle = true;
    return this.execute() as unknown as Promise<PostgrestResponse<T>>;
  }

  public maybeSingle(): Promise<PostgrestResponse<T | null>> {
    this.isMaybeSingle = true;
    return this.execute() as unknown as Promise<PostgrestResponse<T | null>>;
  }

  public then<TResult1 = PostgrestResponse<T[]>, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResponse<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected);
  }

  private async execute(): Promise<PostgrestResponse<any>> {
    const tableRows = activeDatastore[this.tableName];
    if (!tableRows) {
      return {
        data: null,
        error: { message: `Relation "${this.tableName}" does not exist`, code: '42P01' },
      };
    }

    try {
      if (this.action === 'insert') {
        const results: any[] = [];
        for (const rawItem of this.insertData) {
          const item = {
            id: rawItem.id || `gen_${Math.random().toString(36).substring(2, 11)}`,
            created_at: rawItem.created_at || new Date().toISOString(),
            updated_at: rawItem.updated_at || new Date().toISOString(),
            ...rawItem,
          };

          // Validate RLS WITH CHECK policy
          RlsPolicyEvaluator.validateInsert(this.tableName, item, this.context, activeDatastore);

          (tableRows as any[]).push(item);
          results.push(item);
        }

        if (this.isSingle) {
          return { data: results[0] || null, error: null };
        }
        return { data: results, error: null };
      }

      if (this.action === 'update') {
        let matched = this.applyFilters(tableRows as any[]);
        const updatedItems: any[] = [];

        for (const existing of matched) {
          const updated = {
            ...existing,
            ...this.updateData,
            updated_at: new Date().toISOString(),
          };

          // Validate RLS UPDATE policy
          RlsPolicyEvaluator.validateUpdate(
            this.tableName,
            existing,
            updated,
            this.context,
            activeDatastore
          );

          Object.assign(existing, updated);
          updatedItems.push(updated);
        }

        if (this.isSingle) {
          return { data: updatedItems[0] || null, error: null };
        }
        return { data: updatedItems, error: null };
      }

      if (this.action === 'delete') {
        const matched = this.applyFilters(tableRows as any[]);
        const deletedIds = new Set(matched.map((m) => m.id));
        activeDatastore[this.tableName] = (tableRows as any[]).filter(
          (r) => !deletedIds.has(r.id)
        ) as any;
        return { data: matched, error: null };
      }

      // SELECT ACTION:
      // 1. Evaluate RLS policies to isolate tenant records
      const rlsFiltered = RlsPolicyEvaluator.filterSelect(
        this.tableName,
        tableRows as any[],
        this.context,
        activeDatastore
      );

      // 2. Apply query filters (.eq, .gt, etc.)
      let filtered = this.applyFilters(rlsFiltered);

      // 3. Order
      if (this.orderColumn) {
        filtered = filtered.sort((a, b) => {
          const col = this.orderColumn!;
          const aVal = a[col];
          const bVal = b[col];
          if (aVal < bVal) return this.orderAscending ? -1 : 1;
          if (aVal > bVal) return this.orderAscending ? 1 : -1;
          return 0;
        });
      }

      // 4. Limit
      if (this.limitCount !== undefined) {
        filtered = filtered.slice(0, this.limitCount);
      }

      if (this.isSingle) {
        if (filtered.length === 0) {
          return {
            data: null,
            error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
          };
        }
        return { data: filtered[0], error: null };
      }

      if (this.isMaybeSingle) {
        return { data: filtered[0] || null, error: null };
      }

      return { data: filtered, error: null };
    } catch (err: any) {
      return {
        data: null,
        error: {
          message: err.message || String(err),
          code: err.code || '500',
        },
      };
    }
  }

  private applyFilters(rows: any[]): any[] {
    return rows.filter((row) => {
      for (const filter of this.filters) {
        const rowVal = row[filter.column];
        switch (filter.operator) {
          case 'eq':
            if (rowVal !== filter.value) return false;
            break;
          case 'neq':
            if (rowVal === filter.value) return false;
            break;
          case 'gt':
            if (rowVal <= filter.value) return false;
            break;
          case 'gte':
            if (rowVal < filter.value) return false;
            break;
          case 'lt':
            if (rowVal >= filter.value) return false;
            break;
          case 'lte':
            if (rowVal > filter.value) return false;
            break;
          case 'in':
            if (!Array.isArray(filter.value) || !filter.value.includes(rowVal)) return false;
            break;
          case 'is':
            if (filter.value === null && rowVal !== null && rowVal !== undefined) return false;
            if (filter.value !== null && rowVal !== filter.value) return false;
            break;
        }
      }
      return true;
    });
  }
}

export interface MockSupabaseClient {
  from: <T = any>(table: keyof InMemoryDatastore) => MockPostgrestQueryBuilder<T>;
  auth: {
    getUser: () => Promise<{ data: { user: MockAuthUser | null }; error: null }>;
    getSession: () => Promise<{ data: { session: any }; error: null }>;
  };
}

/**
 * Factory creating a scoped mock Supabase client for a given auth context
 */
export function createMockSupabaseClient(context: MockAuthContext = { user: null }): MockSupabaseClient {
  return {
    from: <T = any>(table: keyof InMemoryDatastore) => {
      return new MockPostgrestQueryBuilder<T>(table, context);
    },
    auth: {
      getUser: async () => ({
        data: { user: context.user },
        error: null,
      }),
      getSession: async () => ({
        data: {
          session: context.user
            ? {
                user: context.user,
                access_token: `mock_jwt_${context.user.id}`,
              }
            : null,
        },
        error: null,
      }),
    },
  };
}
