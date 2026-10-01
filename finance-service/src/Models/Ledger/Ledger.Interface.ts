export interface ILedgerEntry {
  id: string;
  journalId: string;
  lineNo: number;
  date: string;
  account: string;
  debitPaise: number;
  creditPaise: number;
  reference: string;
  storeId: string | null;
  sourceType: string;
  sourceId: string;
}

/** One side of a posting. The service pairs debits and credits into a journal. */
export interface ILedgerLineInput {
  account: string;
  debitPaise: number;
  creditPaise: number;
}

export interface ILedgerPosting {
  sourceType: string;
  sourceId: string;
  date: string;
  reference: string;
  storeId: string | null;
  lines: ILedgerLineInput[];
}

export interface ILedgerFilter {
  from?: string;
  to?: string;
  storeId?: string;
  account?: string;
}

export interface ILedgerAccountTotal {
  account: string;
  debitPaise: number;
  creditPaise: number;
}
