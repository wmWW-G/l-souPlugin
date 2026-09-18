"""执行两份DSL的真实代码节点；用有标记的合成数据核验范围/证据，不调用模型。"""
import copy
import inspect
import json
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]
FLOWS = {kind: yaml.safe_load((ROOT / f'dify-chatflows/lsou-operations-todo.{kind}.yaml').read_text())
         for kind in ('workflow', 'chatflow')}


def node(kind, name):
    """读取并执行指定代码节点，返回main函数；DSL代码错误直接抛异常。"""
    data = next(x['data'] for x in FLOWS[kind]['workflow']['graph']['nodes'] if x['id'] == name)
    namespace = {}
    exec(data['code'], namespace)
    return namespace['main']


def example(module='product'):
    """返回最小可用的合成快照；module是六页标识，测试不代表真实店铺表现。"""
    return {'schema_version': '2.0', 'module': module, 'snapshot_id': 'test-snapshot-1',
            'as_of': '2026-09-10T09:00:00+08:00', 'period': {'startDate': '2026-09-01', 'endDate': '2026-09-09'},
            'source': '合成测试', 'data_status': 'ready', 'limitations': ['仅测试数据'],
            'entities': [{'ref': 'product-a', 'label': '测试商品A', 'type': 'product'}],
            'facts': [{'id': 'fact-a', 'label': '测试效果', 'text': '曝光1000，点击20，询盘2；仅合成测试。',
                       'source': '合成测试', 'observed_at': '2026-09-10T09:00:00+08:00',
                       'scope': '测试商品A / 9月1日至9月9日', 'entity_ref': 'product-a'}]}


def proposal():
    """返回满足展示约定的模型输出样本；来源与状态由代码重新绑定。"""
    return {'summary': '先检查这件商品的流量匹配。', 'suggested_questions': ['还需补充什么数据？'],
            'tasks': [{'title': '检查商品与搜索需求是否匹配', 'priority': 'normal',
                       'basis': '测试数据中曝光1000、点击20，还没有同范围同行参考。',
                       'steps': ['核对实际搜索词与商品主词是否相关。'],
                       'acceptance_criteria': ['用同商品同周期记录复查。'],
                       'hypotheses': ['流量匹配可能影响点击，尚不能确认原因。'],
                       'missing_data': ['实际搜索词'], 'follow_up_questions': ['先检查哪些词？'],
                       'entity_ref': 'product-a', 'evidence_ids': ['fact-a'], 'action_ids': ['open_page']}]}


class SixPageFlowTest(unittest.TestCase):
    """覆盖范围切换、无数据、模型伪造及自然语言问答。"""

    def setUp(self):
        """为每个测试建立独立输入与DSL函数。"""
        self.snapshot = example()
        self.prepare = node('workflow', 'prepare')
        self.chat = node('chatflow', 'prepare')
        self.validate = node('workflow', 'validate_result')

    def prepared(self):
        """返回当前测试快照经过真实节点规范化后的JSON文本。"""
        return self.prepare(json.dumps(self.snapshot))['context']

    def test_six_methods_and_exclusions(self):
        """六页有各自SOP方法；RFQ和风险在模型调用前拒绝。"""
        methods = set()
        for module in ('overview', 'visitor', 'product', 'flow', 'market', 'ads'):
            data = self.prepare(json.dumps(example(module)))
            self.assertEqual(data['valid'], 1)
            self.assertIn('SOP', data['method'])
            methods.add(data['method'])
        self.assertEqual(len(methods), 6)
        for module in ('rfq', 'risk'):
            with self.assertRaises(ValueError):
                self.prepare(json.dumps(example(module)))
            self.assertEqual(self.chat(json.dumps(example(module)), '说明一下')['valid'], 0)

    def test_no_data_does_not_invent_findings(self):
        """没有事实时Workflow走空态，Chatflow仍可解释概念。"""
        self.snapshot['facts'] = []
        self.snapshot['entities'] = []
        result = self.prepare(json.dumps(self.snapshot))
        self.assertEqual(result['valid'], 0)
        self.assertEqual(result['empty_result']['status'], 'needs_data')
        self.assertEqual(result['empty_result']['tasks'], [])
        self.assertEqual(self.chat(json.dumps(self.snapshot), 'CTR是什么意思？')['valid'], 1)

    def test_invalid_input(self):
        """非法JSON、日期、重复引用和缺失来源不进入诊断。"""
        invalid = ['[]', '{"module":"product","module":"ads"}', 'not-json']
        for change in ({'period': {'startDate': '2026-02-30'}}, {'as_of': '2026-09-10'},
                       {'facts': [self.snapshot['facts'][0]] * 2}, {'schema_version': '1.0'}):
            invalid.append(json.dumps({**self.snapshot, **change}))
        missing = copy.deepcopy(self.snapshot)
        del missing['facts'][0]['source']
        invalid.append(json.dumps(missing))
        for raw in invalid:
            with self.subTest(raw=raw[:80]), self.assertRaises(ValueError):
                self.prepare(raw)

    def test_output_scope_and_navigation_are_authoritative(self):
        """模型不能改模块、原始证据、完成状态或任意跳转。"""
        output = proposal()
        output.update(module='risk', snapshot_id='wrong', evidence=[{'text': '伪造'}])
        output['tasks'][0].update(state='completed', owner='伪造负责人')
        result = self.validate(json.dumps(output), self.prepared())['result']
        self.assertEqual(result['module'], 'product')
        self.assertEqual(result['snapshot_id'], 'test-snapshot-1')
        self.assertEqual(result['tasks'][0]['state'], 'suggested')
        self.assertNotIn('owner', result['tasks'][0])
        self.assertEqual(result['evidence'], self.snapshot['facts'])
        self.assertEqual(result['actions'][0]['target_tab'], 'product')
        self.assertEqual(result['status'], 'ok')

    def test_unknown_refs_actions_and_cross_object_are_rejected(self):
        """不存在或跨商品的引用使生成失败，不伪装为成功空结果。"""
        for change in ({'entity_ref': 'invented'}, {'evidence_ids': ['invented']},
                       {'evidence_ids': ['fact-a', 'fact-a']}, {'action_ids': ['delete_product']}):
            output = proposal()
            output['tasks'][0].update(change)
            with self.assertRaises(ValueError):
                self.validate(json.dumps(output), self.prepared())
        self.snapshot['entities'].append({'ref': 'product-b', 'label': '测试B', 'type': 'product'})
        output = proposal()
        output['tasks'][0]['entity_ref'] = 'product-b'
        with self.assertRaises(ValueError):
            self.validate(json.dumps(output), self.prepared())

    def test_malformed_output_differs_from_empty(self):
        """格式错误会抛错；真实没有优先问题可以返回空任务。"""
        for text in ('not json', '[]', '{}'):
            with self.assertRaises(ValueError):
                self.validate(text, self.prepared())
        output = proposal()
        output['tasks'] = []
        result = self.validate(json.dumps(output), self.prepared())['result']
        self.assertEqual(result['tasks'], [])
        self.assertEqual(result['status'], 'ok')

    def test_reasoning_prefix_and_fence(self):
        """思考前缀和JSON围栏不进入最终结果。"""
        text = '<think>测试内部思考</think>\n```json\n' + json.dumps(proposal()) + '\n```'
        result = self.validate(text, self.prepared())
        self.assertNotIn('内部思考', result['raw_result'])

    def test_current_turn_overrides_old_inputs(self):
        """同一对话切换日期/对象时使用本轮数据，首轮inputs失效也不会回退。"""
        current = example('market')
        current['snapshot_id'] = 'new-snapshot'
        query = json.dumps({'lsou_turn': '2.0', 'question': '这个说明什么？', 'business_context': current})
        for old in (json.dumps(self.snapshot), 'invalid old inputs'):
            result = self.chat(old, query)
            self.assertEqual(result['valid'], 1)
            self.assertEqual(result['question'], '这个说明什么？')
            self.assertEqual(json.loads(result['context'])['snapshot_id'], 'new-snapshot')
            self.assertIn('市场定位', result['method'])
        invalid = json.dumps({'lsou_turn': '2.0', 'question': '继续', 'business_context': {}})
        self.assertEqual(self.chat(json.dumps(self.snapshot), invalid)['valid'], 0)

    def test_analysis_and_selection_must_match_current_snapshot(self):
        """旧解读或不存在的对象不会被绑定到本轮事实。"""
        self.snapshot['analysis_result'] = {'module': 'product', 'snapshot_id': 'old'}
        self.snapshot['selection'] = {'entity_ref': 'unknown', 'label': '别的商品'}
        result = self.chat(json.dumps(self.snapshot), '解释一下')
        self.assertEqual(result['analysis'], 'null')
        self.assertNotIn('entity_ref', json.loads(result['selection']))
        self.snapshot['analysis_result']['snapshot_id'] = self.snapshot['snapshot_id']
        self.assertNotEqual(self.chat(json.dumps(self.snapshot), '解释一下')['analysis'], 'null')

    def test_legacy_overview_input(self):
        """旧总览输入仍可导入，输出升级为可验证2.0结构。"""
        old = {'module': 'overview', 'as_of': self.snapshot['as_of'], 'metrics': {'曝光': 100}, 'period': {}}
        result = self.prepare(json.dumps(old))
        context = json.loads(result['context'])
        self.assertEqual(result['valid'], 1)
        self.assertEqual(context['schema_version'], '2.0')
        self.assertEqual(context['facts'][0]['id'], 'metrics')

    def test_chat_is_natural_language_with_bounded_memory(self):
        """问答直接输出自然语言，记忆保留有限轮数且不混入模型思考。"""
        graph = {x['id']: x['data'] for x in FLOWS['chatflow']['workflow']['graph']['nodes']}
        self.assertEqual(FLOWS['chatflow']['app']['mode'], 'advanced-chat')
        self.assertEqual(graph['answer_node']['answer'], '{{#llm_node.text#}}')
        self.assertTrue(graph['llm_node']['memory']['window']['enabled'])
        self.assertLessEqual(graph['llm_node']['memory']['window']['size'], 6)
        self.assertEqual(graph['llm_node']['memory']['query_prompt_template'], '{{#prepare.question#}}')

    def test_published_schema_matches_workflow_model_node(self):
        """交给用户复制的Schema必须与本地模型节点相同，防止修改后出现两份字段标准。"""
        schema = json.loads((ROOT / 'dify-chatflows/overview-todo.output-schema.json').read_text())
        graph = {item['id']: item['data'] for item in FLOWS['workflow']['workflow']['graph']['nodes']}
        self.assertEqual(graph['llm_node']['structured_output']['schema'], schema)
        self.assertEqual(set(schema['required']), set(schema['properties']))
        task = schema['properties']['tasks']['items']
        self.assertEqual(set(task['required']), set(task['properties']))
        self.assertTrue(all(field.get('description') for field in task['properties'].values()))

    def test_related_profiles_and_conditional_planning(self):
        """八份方法分配到六页；追问计划才为商品页补入规划，客户方法不混入RFQ。"""
        expected = {
            'overview': ('01-数据看板.md', '07-数据分析与优化.md', '02-运营规划.md'),
            'visitor': ('08-商机转化.md',),
            'product': ('06-优爆品提升.md', '04-运营基建.md'),
            'flow': ('07-数据分析与优化.md', '03-营销定位.md', '05-运营推广.md'),
            'market': ('03-营销定位.md', '04-运营基建.md'),
            'ads': ('05-运营推广.md', '04-运营基建.md'),
        }
        for module, sources in expected.items():
            with self.subTest(module=module):
                method = self.prepare(json.dumps(example(module)))['method']
                self.assertEqual(method.count('【运营方法来源：'), len(sources))
                for source in sources:
                    self.assertIn('【运营方法来源：' + source + '】', method)
        ordinary = self.chat(json.dumps(self.snapshot), '这个指标什么意思？')['method']
        planning = self.chat(json.dumps(self.snapshot), '帮我安排下一阶段的计划')['method']
        self.assertNotIn('【运营方法来源：02-运营规划.md】', ordinary)
        self.assertIn('【运营方法来源：02-运营规划.md】', planning)
        visitor = self.prepare(json.dumps(example('visitor')))['method']
        self.assertNotIn('RFQ', visitor.split('【运营方法来源：08-商机转化.md】')[1])

    def test_retrieval_uses_current_question_and_selected_object(self):
        """超过采样上限时优先检索选中商品；旧页面和旧分析不能污染本轮主题。"""
        current = example('ads')
        current['snapshot_id'] = 'current-ad-snapshot'
        current['entities'].append({'ref': 'product-b', 'label': '当前广告商品B', 'type': 'product'})
        current['facts'] = [{**current['facts'][0], 'id': f'fact-{i}'} for i in range(8)]
        current['facts'].append({**current['facts'][0], 'id': 'selected-fact',
                                 'entity_ref': 'product-b', 'label': '选中广告商品事实'})
        current['selection'] = {'entity_ref': 'product-b', 'label': '当前广告商品B'}
        current['analysis_result'] = {'module': 'product', 'snapshot_id': 'test-snapshot-1',
                                      'summary': '旧商品结论'}
        envelope = json.dumps({'lsou_turn': '2.0', 'question': '这个商品的广告怎么调整？',
                               'business_context': current})
        prepared = self.chat(json.dumps(self.snapshot), envelope)
        output = node('chatflow', 'retrieval_input')(
            **{key: prepared[key] for key in ('context', 'question', 'analysis', 'selection')})
        request = json.loads(output['request'])
        self.assertEqual(request['question'], '这个商品的广告怎么调整？')
        self.assertEqual(request['facts_sample'][0]['label'], '选中广告商品事实')
        self.assertEqual(len(request['facts_sample']), 6)
        self.assertIsNone(request['previous_analysis'])
        self.assertNotIn('旧商品结论', output['request'])
        self.assertNotIn('entity_ref', output['request'])

    def test_retrieval_keeps_only_matching_analysis_and_handles_missing_tasks(self):
        """检索摘要只承接同模块同快照的分析，畸形可选主题列表不使问答失败。"""
        retrieval = node('chatflow', 'retrieval_input')
        report = {'module': 'product', 'snapshot_id': self.snapshot['snapshot_id'],
                  'summary': '本轮待验证假设', 'tasks': [{'title': '本轮主题'}]}
        result = retrieval(self.prepared(), '第二项为什么？', json.dumps(report), '{}')
        previous = json.loads(result['request'])['previous_analysis']
        self.assertEqual(previous['finding_titles'], ['本轮主题'])
        for change in ({'module': 'ads'}, {'snapshot_id': 'old-snapshot'}):
            result = retrieval(self.prepared(), '为什么？', json.dumps({**report, **change}), '{}')
            self.assertIsNone(json.loads(result['request'])['previous_analysis'])
        for tasks in (None, '异常列表', {'title': '异常对象'}):
            result = retrieval(self.prepared(), '为什么？', json.dumps({**report, 'tasks': tasks}), '{}')
            self.assertEqual(json.loads(result['request'])['previous_analysis']['finding_titles'], [])

    def test_retrieval_is_bounded_and_omits_contact_details(self):
        """检索材料不复制长报告与联系方式；事实和规则版本主题仍能进入检索。"""
        question = '按2026版方法分析点击率；联系 test@example.com +86 13812345678 https://example.com/private app-abcdef123456 '
        self.snapshot['facts'][0]['text'] = question + '测试素材' * 180
        result = node('chatflow', 'retrieval_input')(self.prepared(), question * 30, 'null', '{}')
        request = json.loads(result['request'])
        for private in ('test@example.com', '13812345678', 'https://example.com', 'app-abcdef123456'):
            self.assertNotIn(private, result['request'])
            self.assertNotIn(private, result['fallback_query'])
        self.assertIn('2026版方法', request['question'])
        self.assertLessEqual(len(request['question']), 800)
        self.assertLessEqual(len(request['facts_sample'][0]['text']), 450)
        self.assertLessEqual(len(result['fallback_query']), 512)

    def test_query_guard_falls_back_without_inventing_model_output(self):
        """空白、格式错、过长或未闭合推理输出使用本轮保底；合法改写去除推理后保留。"""
        for kind in FLOWS:
            guard = node(kind, 'query_guard')
            for text in ('', None, '{}', '[]', '```text\n查询\n```', '# 错误格式',
                         '词' * 513, '<think>未完成的推理'):
                with self.subTest(kind=kind, text=str(text)[:30]):
                    self.assertEqual(guard(text, '本轮商品点击诊断'),
                                     {'query': '本轮商品点击诊断', 'query_source': 'fallback'})
            result = guard('<think>不可显示的推理</think>\n商品点击率诊断方法', '保底')
            self.assertEqual(result, {'query': '商品点击率诊断方法', 'query_source': 'rewrite'})
            self.assertTrue(guard('', '')['query'])
            self.assertLessEqual(len(guard('', '长' * 800)['query']), 512)

    def test_knowledge_source_cannot_become_business_evidence(self):
        """知识库给方法，不能凭片段ID伪造当前店铺事实引用。"""
        output = proposal()
        output['tasks'][0]['evidence_ids'] = ['knowledge-segment-1']
        with self.assertRaisesRegex(ValueError, '证据'):
            self.validate(json.dumps(output), self.prepared())

    def test_dify_code_entrypoints_match_declared_inputs(self):
        """执行实际代码并核对Dify入口参数，捕获新增节点在平台运行时的参数错位。"""
        for kind, flow in FLOWS.items():
            for item in flow['workflow']['graph']['nodes']:
                data = item['data']
                if data['type'] == 'code':
                    with self.subTest(kind=kind, node=item['id']):
                        main = node(kind, item['id'])
                        self.assertEqual(set(inspect.signature(main).parameters),
                                         {var['variable'] for var in data['variables']})

    def test_knowledge_graph_preserves_no_data_exit_and_context(self):
        """知识检索位于有效输入分支；顾问接收原生检索上下文，问答改写记忆绑定本轮问题。"""
        for kind, flow in FLOWS.items():
            graph = flow['workflow']['graph']
            nodes = {item['id']: item['data'] for item in graph['nodes']}
            edges = {(item['source'], item['sourceHandle'], item['target']) for item in graph['edges']}
            for source, target in (('retrieval_input', 'query_rewrite'), ('query_rewrite', 'query_guard'),
                                   ('query_guard', 'knowledge'), ('knowledge', 'llm_node')):
                self.assertIn((source, 'source', target), edges)
            self.assertIn(('gate', 'true', 'retrieval_input'), edges)
            self.assertIn(('gate', 'false', 'no_data'), edges)
            self.assertEqual(nodes['knowledge']['query_variable_selector'], ['query_guard', 'query'])
            self.assertEqual(nodes['llm_node']['context'],
                             {'enabled': True, 'variable_selector': ['knowledge', 'result']})
            self.assertIn('{{#context#}}', nodes['llm_node']['prompt_template'][1]['text'])
            self.assertEqual(nodes['query_rewrite']['error_strategy'], 'default-value')
            self.assertFalse(nodes['query_rewrite']['retry_config']['retry_enabled'])
            if kind == 'chatflow':
                self.assertEqual(nodes['query_rewrite']['memory']['query_prompt_template'], '{{#prepare.question#}}')
            else:
                self.assertNotIn('memory', nodes['query_rewrite'])
                self.assertIsNone(json.loads(node(kind, 'retrieval_input')(self.prepared())['request'])['previous_analysis'])


if __name__ == '__main__':
    unittest.main()
