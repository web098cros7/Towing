import type { DashboardData } from '../types';

/** Driver dashboard seed (Figma driver "Home"). */
export const dashboardMock: DashboardData = {
  driverName: 'Rahul',
  summary: {
    jobsCompleted: 8,
    earningsPaise: 648_000,
    rating: 4.8,
  },
  recentActivity: [
    {
      id: 'a1',
      vehicleName: 'Maruti Swift',
      pickup: 'Palam, Delhi',
      drop: 'Dwarka, Delhi',
      farePaise: 85000,
      status: 'completed',
    },
    {
      id: 'a2',
      vehicleName: 'Hyundai i20',
      pickup: 'Gurgaon Sector 45',
      drop: 'Sector 29, Gurgaon',
      farePaise: 120000,
      status: 'completed',
    },
    {
      id: 'a3',
      vehicleName: 'Tata Nexon',
      pickup: 'Janakpuri, Delhi',
      drop: 'Mukherjee Nagar, Delhi',
      farePaise: 95000,
      status: 'cancelled',
    },
  ],
};
