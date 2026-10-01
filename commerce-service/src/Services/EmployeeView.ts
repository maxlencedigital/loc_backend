import { IEmployee } from "../Models/Hr/Employee.Interface.js";
import { decryptField } from "../Utils/FieldCipher.js";
import { formatDate } from "../Utils/HrDate.js";

const MASK = "•";

const maskAccount = (last4: string | null): string => `${MASK.repeat(6)}${last4 ?? ""}`;
const maskIfsc = (ifsc: string | null): string => (ifsc ? `${ifsc.slice(0, 4)}${MASK.repeat(Math.max(0, ifsc.length - 4))}` : "");

const bankAccountView = (employee: IEmployee, sensitive: boolean) => {
  if (!employee.bankAccountEnc && !employee.bankHolderName) return null;
  let accountNumber = maskAccount(employee.bankAccountLast4);
  if (sensitive && employee.bankAccountEnc) {
    try {
      accountNumber = decryptField(employee.bankAccountEnc);
    } catch {
      // An unreadable value is shown masked rather than failing the whole record.
      console.error(`[hr-core] could not decrypt the bank account of employee ${employee.id}`);
    }
  }
  return {
    holderName: employee.bankHolderName,
    accountNumber,
    ifsc: sensitive ? employee.bankIfsc : maskIfsc(employee.bankIfsc),
  };
};

// The one place an employee leaves the service. Bank account, date of birth, address,
// pay grade and exit reason go only to HR and admins; everyone else gets them masked or absent.
export const toEmployeeView = (employee: IEmployee, sensitive: boolean) => ({
  id: employee.id,
  code: employee.code,
  name: employee.name,
  employeeType: employee.employeeType,
  phone: employee.phone,
  email: employee.email,
  storeId: employee.storeId,
  role: employee.role,
  designation: employee.designation,
  joinDate: formatDate(employee.joinDate),
  emergencyContact: employee.emergencyName
    ? { name: employee.emergencyName, phone: employee.emergencyPhone, relation: employee.emergencyRelation }
    : null,
  bankAccount: bankAccountView(employee, sensitive),
  gatewayUserId: employee.gatewayUserId,
  reportingTo: employee.reportingTo,
  status: employee.status,
  lastWorkingDay: employee.lastWorkingDay ? formatDate(employee.lastWorkingDay) : null,
  createdAt: employee.createdAt.toISOString(),
  updatedAt: employee.updatedAt.toISOString(),
  ...(sensitive
    ? {
        dateOfBirth: employee.dateOfBirth ? formatDate(employee.dateOfBirth) : null,
        address: employee.address,
        payGrade: employee.payGrade,
        exitReason: employee.exitReason,
      }
    : {}),
});
