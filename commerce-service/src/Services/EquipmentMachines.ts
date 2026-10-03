import { MachinesService } from "./Machines.Service.js";

// The register is the business record; the store floor owns the machine it runs. The floor's
// own service functions (the ones behind its /internal/machines routes) are called in-process,
// and a floor problem never fails a register change: it is logged and the register carries on.
const FLOOR_TYPES = ["washer", "dryer", "press", "iron", "other"];

interface NewMachine {
  storeId: string;
  assetTag: string;
  name: string;
  type: string;
  capacityGrams: number | null;
}

// Boilers and generators are not floor machines, and the floor needs a capacity.
const register = async (item: NewMachine): Promise<string | null> => {
  if (!FLOOR_TYPES.includes(item.type) || item.capacityGrams === null) return null;
  try {
    const machine = (await MachinesService.registerMachine({
      storeId: item.storeId,
      code: item.assetTag,
      name: item.name,
      type: item.type,
      capacityKg: item.capacityGrams / 1000,
    })) as { id: string };
    return machine.id;
  } catch (error) {
    console.warn(`[equipment] could not register ${item.assetTag} on the floor:`, (error as Error).message);
    return null;
  }
};

const setState = async (machineId: string | null, state: "idle" | "maintenance"): Promise<void> => {
  if (!machineId) return;
  try {
    await MachinesService.setMachineState({ machineId, state });
  } catch (error) {
    console.warn(`[equipment] could not set machine ${machineId} to ${state}:`, (error as Error).message);
  }
};

export const EquipmentMachines = { register, setState };
