export type GstStatus = "draft" | "ready" | "filed";

export interface IGstLine {
  storeId: string | null;
  orders: number;
  grossPaise: number;
  refundsPaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
}

export interface IGstFigures {
  rateBps: number;
  grossPaise: number;
  refundsPaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  orderCount: number;
  storeIds: string[];
  lines: IGstLine[];
}

export interface IGstReport extends IGstFigures {
  id: string;
  month: string;
  status: GstStatus;
  generatedAt: Date;
  generatedByUserId: string;
  filedAt: Date | null;
  filedByUserId: string | null;
  acknowledgement: string | null;
  createdAt: Date;
  updatedAt: Date;
}
