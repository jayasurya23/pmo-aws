import { Route, Routes } from "react-router-dom";
import { DrillProvider } from "@/components/DrillDrawer";
import Layout from "@/components/Layout";
import { MetaProvider } from "@/components/meta";
import { FilterProvider } from "@/lib/filters";
import About from "@/pages/About";
import Actions from "@/pages/Actions";
import Capacity from "@/pages/Capacity";
import Commercial from "@/pages/Commercial";
import Delivery from "@/pages/Delivery";
import Executive from "@/pages/Executive";
import Pipeline from "@/pages/Pipeline";
import Project from "@/pages/Project";
import Quality from "@/pages/Quality";
import Scenarios from "@/pages/Scenarios";

export default function App() {
  return (
    <MetaProvider>
      <FilterProvider>
        <DrillProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Executive />} />
              <Route path="delivery" element={<Delivery />} />
              <Route path="capacity" element={<Capacity />} />
              <Route path="actions" element={<Actions />} />
              <Route path="commercial" element={<Commercial />} />
              <Route path="quality" element={<Quality />} />
              <Route path="projects/:id" element={<Project />} />
              <Route path="scenarios" element={<Scenarios />} />
              <Route path="pipeline" element={<Pipeline />} />
              <Route path="about" element={<About />} />
              <Route path="*" element={<div className="text-brand-gray">Not found.</div>} />
            </Route>
          </Routes>
        </DrillProvider>
      </FilterProvider>
    </MetaProvider>
  );
}
