export type Place = {
  id: string;
  name: string;
  short: string;
  description: string;
  lat: number;
  lng: number;
  category: string[];
  address: string;
};

export type Route = {
  id: string;
  title: string;
  duration: "1h" | "2h" | "4h";
  summary: string;
  placeIds: string[];
  tags: string[];
};
