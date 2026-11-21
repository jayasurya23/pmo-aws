import { Navigate, Route, Routes } from "react-router-dom";
import { DrillProvider } from "@/components/DrillDrawer";
import Layout from "@/components/Layout";
import { STATIC } from "@/lib/api";
import Start from "@/pages/Start";
import { MetaProvider } from "@/components/meta";
import { FilterProvider } from "@/lib/filters";
import Actions from "@/pages/Actions";
import Capacity from "@/pages/Capacity";
import Billables from "@/pages/Billables";
import Proposals from "@/pages/Proposals";
import MyWeek from "@/pages/MyWeek";
import Delivery from "@/pages/Delivery";
import Executive from "@/pages/Executive";
import Pipeline from "@/pages/Pipeline";
import Project from "@/pages/Project";
import DecisionPage from "@/pages/Scenarios";

function ScenarioRedirect() {
  return <Navigate to={"/decisions/client-decision"} replace />;
}

export default function App() {
  return (
    <MetaProvider>
      <FilterProvider>
        <DrillProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={STATIC ? <Start /> : <Executive />} />
              <Route path="overview" element={<Executive />} />
              <Route path="start" element={<Start />} />
              <Route path="delivery" element={<Delivery />} />
              <Route path="capacity" element={<Capacity />} />
              <Route path="actions" element={<Actions />} />
              <Route path="proposals" element={<Proposals />} />
              <Route path="my-week" element={<MyWeek />} />
              <Route path="billables" element={<Billables />} />
              <Route path="commercial" element={<Navigate to="/proposals" replace />} />
              <Route path="quality" element={<Navigate to="/pipeline" replace />} />
              <Route path="projects/:id" element={<Project />} />
              <Route path="decisions/:slug" element={<DecisionPage />} />
              <Route path="decisions" element={<Navigate to="/decisions/client-decision" replace />} />
              <Route path="scenarios" element={<ScenarioRedirect />} />
              <Route path="pipeline" element={<Pipeline />} />
              <Route path="*" element={<div className="text-brand-gray text-[16px]">Page not found.</div>} />
            </Route>
          </Routes>
        </DrillProvider>
      </FilterProvider>
    </MetaProvider>
  );
}
